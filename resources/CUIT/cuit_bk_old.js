// 文件: cuit.js
// 成都信息工程大学 (CUIT) 教务系统课程表导入脚本
// 基于树维教务 HTML 表格解析，适用于 http://jwgl.cuit.edu.cn/eams/courseTableForStd!courseTable.action
// https://jwc.cuit.edu.cn/

// ==================== 页面检测 ====================
function isOnCourseTablePage() {
  const url = window.location.href;
  return /\/eams\/courseTableForStd!courseTable\.action/i.test(url);
}

// ==================== 工具函数：周次解析 ====================
function parseWeeks(weeksStr) {
  if (!weeksStr) return [];
  const ranges = weeksStr.split(",");
  const weeks = [];
  for (const range of ranges) {
    const match = range.match(/(\d+)-(\d+)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      for (let i = start; i <= end; i++) {
        weeks.push(i);
      }
    } else {
      const single = parseInt(range, 10);
      if (!isNaN(single)) weeks.push(single);
    }
  }
  return weeks;
}

// ==================== 核心解析：从 HTML 表格提取课程 ====================
function parseCellContent(td, day, startSection, endSection) {
  const courses = [];

  let title = td.getAttribute("title") || "";
  if (!title) {
    const text = td.textContent.replace(/\s+/g, " ").trim();
    if (!text) return courses;
    courses.push({
      name: text.split(" ")[0],
      teacher: "",
      position: "",
      day: day,
      startSection: startSection,
      endSection: endSection,
      weeks: [],
      isCustomTime: false,
    });
    return courses;
  }

  const courseBlocks = title.split(";;").filter((block) => block.trim() !== "");

  for (const block of courseBlocks) {
    const parts = block.split(";").map((s) => s.trim());
    let courseName = "";
    let teacher = "";
    let weeksStr = "";
    let position = "";

    for (const part of parts) {
      if (part.startsWith("教师：")) {
        teacher = part.replace("教师：", "").trim();
      } else if (part.startsWith("周次：")) {
        weeksStr = part.replace("周次：", "").replace("周", "").trim();
      } else if (part.startsWith("教室：")) {
        position = part.replace("教室：", "").trim();
      } else if (part && !part.includes("：")) {
        courseName = part;
      }
    }

    if (!courseName && parts.length > 0) {
      courseName = parts[0];
    }

    const weeks = parseWeeks(weeksStr);

    courses.push({
      name: courseName || "未知课程",
      teacher: teacher,
      position: position,
      day: day,
      startSection: startSection,
      endSection: endSection,
      weeks: weeks,
      isCustomTime: false,
    });
  }

  return courses;
}

async function parseAndImportCoursesFromPage() {
  AndroidBridge.showToast("正在解析课表表格...");

  const table = document.querySelector("table#manualArrangeCourseTable");
  if (!table) {
    await window.AndroidBridgePromise.showAlert(
      "解析失败",
      "未找到课表表格 (id='manualArrangeCourseTable')，请确保已进入课表页面。",
      "确定",
    );
    return false;
  }

  const theadRow = table.querySelector("thead tr");
  if (!theadRow) {
    await window.AndroidBridgePromise.showAlert(
      "解析失败",
      "表格结构异常，无表头行。",
      "确定",
    );
    return false;
  }

  const dayHeaders = Array.from(theadRow.querySelectorAll("th")).slice(1);
  const dayCount = dayHeaders.length;
  const columnToDay = {};
  dayHeaders.forEach((th, idx) => {
    const text = th.textContent.trim();
    const dayMap = {
      星期一: 1,
      星期二: 2,
      星期三: 3,
      星期四: 4,
      星期五: 5,
      星期六: 6,
      星期日: 7,
    };
    columnToDay[idx] = dayMap[text] || idx + 1;
  });

  const tbody = table.querySelector("tbody");
  if (!tbody) {
    await window.AndroidBridgePromise.showAlert(
      "解析失败",
      "表格缺少 tbody。",
      "确定",
    );
    return false;
  }
  const rows = Array.from(tbody.querySelectorAll("tr"));

  const rowspanTracker = new Array(dayCount).fill(null);
  const courses = [];
  const courseSet = new Set();

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const tr = rows[rowIdx];
    const startSection = rowIdx + 1;
    const cells = Array.from(tr.children);
    const dataCells = cells.slice(1);

    let colIdx = 0;
    for (let cellIdx = 0; cellIdx < dataCells.length; cellIdx++) {
      const td = dataCells[cellIdx];

      while (
        colIdx < dayCount &&
        rowspanTracker[colIdx] &&
        rowspanTracker[colIdx].remain > 0
      ) {
        rowspanTracker[colIdx].remain--;
        if (rowspanTracker[colIdx].remain === 0) {
          rowspanTracker[colIdx] = null;
        }
        colIdx++;
      }

      if (colIdx >= dayCount) break;

      const rowspan = parseInt(td.getAttribute("rowspan") || "1", 10);
      if (rowspan > 1) {
        rowspanTracker[colIdx] = {
          remain: rowspan - 1,
          cellData: null,
        };
      }

      const title = td.getAttribute("title") || "";
      const bgColor = td.style.backgroundColor;
      if (!title && bgColor === "rgb(255, 255, 255)") {
        colIdx++;
        continue;
      }

      const cellCourses = parseCellContent(
        td,
        columnToDay[colIdx],
        startSection,
        startSection + rowspan - 1,
      );

      if (rowspan > 1) {
        rowspanTracker[colIdx].cellData = cellCourses;
      }

      for (const course of cellCourses) {
        const key = `${course.name}|${course.teacher}|${course.position}|${course.day}|${course.startSection}|${course.weeks.join(",")}`;
        if (!courseSet.has(key)) {
          courseSet.add(key);
          courses.push(course);
        }
      }

      colIdx++;
    }

    for (; colIdx < dayCount; colIdx++) {
      if (rowspanTracker[colIdx] && rowspanTracker[colIdx].remain > 0) {
        rowspanTracker[colIdx].remain--;
        if (rowspanTracker[colIdx].remain === 0) {
          rowspanTracker[colIdx] = null;
        }
      }
    }
  }

  if (courses.length === 0) {
    await window.AndroidBridgePromise.showAlert(
      "提示",
      "未提取到任何课程数据，请确认课表页面已完全加载。",
      "确定",
    );
    return false;
  }

  try {
    await window.AndroidBridgePromise.saveImportedCourses(
      JSON.stringify(courses),
    );
    AndroidBridge.showToast(`成功导入 ${courses.length} 门课程！`);
    return true;
  } catch (error) {
    AndroidBridge.showToast(`保存失败: ${error.message}`);
    return false;
  }
}

// ==================== 时间段配置（CUIT 实际作息时间） ====================
async function importCUITTimeSlots() {
  console.log("正在准备 CUIT 时间段数据...");
  const timeSlots = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:15", endTime: "10:00" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
    { number: 9, startTime: "17:40", endTime: "18:25" },
    { number: 10, startTime: "19:30", endTime: "20:15" },
    { number: 11, startTime: "20:25", endTime: "21:10" },
    { number: 12, startTime: "21:20", endTime: "22:05" },
  ];

  try {
    const result = await window.AndroidBridgePromise.savePresetTimeSlots(
      JSON.stringify(timeSlots),
    );
    if (result === true) {
      console.log("CUIT 时间段导入成功！");
      AndroidBridge.showToast("作息时间配置成功！");
      return true;
    } else {
      AndroidBridge.showToast("时间段配置失败");
      return false;
    }
  } catch (error) {
    console.error("导入时间段出错:", error);
    AndroidBridge.showToast("时间段配置出错: " + error.message);
    return false;
  }
}

// ==================== 课表配置（可选） ====================
async function importCourseConfig() {
  // 可根据实际情况调整，例如从页面抓取学期开始日期
  const config = {
    semesterStartDate: "2026-03-02", // 请根据实际开学日期修改
    semesterTotalWeeks: 20,
    defaultClassDuration: 45,
    defaultBreakDuration: 10,
    firstDayOfWeek: 1,
  };

  try {
    await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
    console.log("课表配置导入成功");
    return true;
  } catch (error) {
    console.warn("课表配置导入失败（可忽略）:", error);
    return false;
  }
}

// ==================== 主导入流程 ====================
async function importCourseSchedule() {
  try {
    console.log("开始导入 CUIT 课程表...");
    AndroidBridge.showToast("正在解析课表数据...");

    // 1. 解析并导入课程
    const coursesSuccess = await parseAndImportCoursesFromPage();
    if (!coursesSuccess) {
      return false;
    }

    // 2. 导入时间段
    await importCUITTimeSlots();

    // 3. 导入配置（可选）
    await importCourseConfig();

    return true;
  } catch (error) {
    console.error("导入过程出错:", error);
    AndroidBridge.showToast("导入失败: " + error.message);
    return false;
  }
}

// ==================== 以下为演示函数（保留用于测试） ====================
async function demoAlert() {
  try {
    const confirmed = await window.AndroidBridgePromise.showAlert(
      "重要通知",
      "这是一个弹窗示例。",
      "好的",
    );
    AndroidBridge.showToast(confirmed ? "用户点击了确认" : "用户取消了");
    return confirmed;
  } catch (error) {
    AndroidBridge.showToast("Alert 出错: " + error.message);
    return false;
  }
}

function validateName(name) {
  if (!name || name.trim().length === 0) return "输入不能为空！";
  if (name.length < 2) return "姓名至少需要2个字符！";
  return false;
}

async function demoPrompt() {
  try {
    const name = await window.AndroidBridgePromise.showPrompt(
      "输入你的姓名",
      "请输入至少2个字符",
      "测试用户",
      "validateName",
    );
    if (name !== null) {
      AndroidBridge.showToast("欢迎你，" + name + "！");
      return true;
    }
    return false;
  } catch (error) {
    AndroidBridge.showToast("Prompt 出错: " + error.message);
    return false;
  }
}

async function demoSingleSelection() {
  const fruits = ["苹果", "香蕉", "橙子", "葡萄"];
  try {
    const idx = await window.AndroidBridgePromise.showSingleSelection(
      "选择喜欢的水果",
      JSON.stringify(fruits),
      0,
    );
    if (idx !== null) {
      AndroidBridge.showToast("你选择了 " + fruits[idx]);
      return true;
    }
    return false;
  } catch (error) {
    AndroidBridge.showToast("选择出错: " + error.message);
    return false;
  }
}

async function runDemoMode() {
  AndroidBridge.showToast("演示模式启动...");
  await demoAlert();
  await demoPrompt();
  await demoSingleSelection();
  AndroidBridge.notifyTaskCompletion();
}

// ==================== 入口逻辑 ====================
AndroidBridge.showToast("CUIT 课表适配脚本已加载");

if (isOnCourseTablePage()) {
  console.log("检测到 CUIT 课表页面，开始导入流程");
  setTimeout(async () => {
    const success = await importCourseSchedule();
    if (success) {
      AndroidBridge.notifyTaskCompletion();
    }
  }, 1000);
} else {
  console.log("当前不在课表页面，可运行演示模式");
  AndroidBridge.showToast("请进入课表页面后重试，或运行演示模式");

  // 如需测试弹窗功能，可将下行取消注释
  // runDemoMode();
}
