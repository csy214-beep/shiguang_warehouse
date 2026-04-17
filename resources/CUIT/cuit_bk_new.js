// == 成都信息工程大学（CUIT）新教务系统课表适配脚本 ==
// 适用页面：https://sjjx.cuit.edu.cn:56443/labms/#/course/my
// 特征：Ant Design Table，课程卡片包含具体时间
// 代码结构遵循统一适配规范，数据来源为页面 DOM 解析

(function () {
  // ---------- 通用工具函数 ----------
  function showToast(message) {
    if (typeof AndroidBridge !== "undefined" && AndroidBridge.showToast) {
      AndroidBridge.showToast(message);
    } else {
      console.log("[Toast]", message);
    }
  }

  // 解析周次字符串（如 "第2-11周" -> [2,3,...,11]）
  function parseWeeks(weeksStr) {
    const weeks = [];
    if (!weeksStr) return weeks;
    const match = weeksStr.match(/第(\d+)(?:-(\d+))?周/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : start;
      for (let i = start; i <= end; i++) weeks.push(i);
    }
    return weeks;
  }

  // 解析时间范围（如 "08:20~10:00" -> { start: "08:20", end: "10:00" }）
  function parseTimeRange(timeStr) {
    const match = timeStr.match(/(\d{2}:\d{2})~(\d{2}:\d{2})/);
    return match ? { start: match[1], end: match[2] } : { start: "", end: "" };
  }

  // 从单个课程卡片提取课程数据
  function parseCourseCard(card, day, startSection, endSection) {
    const course = {
      name: "",
      teacher: "", // 页面未提供教师，留空
      position: "",
      day: day,
      startSection: startSection,
      endSection: endSection,
      weeks: [],
      isCustomTime: true,
      customStartTime: "",
      customEndTime: "",
    };

    // 课程名称
    const titleSpan = card.querySelector(".course-title span");
    if (titleSpan) {
      course.name = titleSpan.textContent.trim();
    } else {
      const titleP = card.querySelector(".course-title");
      if (titleP) {
        course.name = titleP.textContent.replace(/^【[^】]*】/, "").trim();
      }
    }

    // 上课地点
    const placeP = Array.from(card.querySelectorAll("p")).find((p) =>
      p.textContent.includes("地点："),
    );
    if (placeP) {
      const span = placeP.querySelector("span");
      course.position = span
        ? span.textContent.trim()
        : placeP.textContent.replace("地点：", "").trim();
    }

    // 时间与周次
    const timeP = Array.from(card.querySelectorAll("p")).find((p) =>
      p.textContent.includes("时间："),
    );
    if (timeP) {
      const span = timeP.querySelector("span");
      const fullText = span
        ? span.textContent.trim()
        : timeP.textContent.replace("时间：", "").trim();
      const parts = fullText.split(" ");
      let weeksPart = parts[0] || "";
      let timePart = parts.slice(1).join(" ") || "";
      if (!timePart) {
        const weekMatch = fullText.match(/第[\d-]+周/);
        weeksPart = weekMatch ? weekMatch[0] : "";
        timePart = fullText.replace(weeksPart, "").trim();
      }
      course.weeks = parseWeeks(weeksPart);
      const timeRange = parseTimeRange(timePart);
      course.customStartTime = timeRange.start;
      course.customEndTime = timeRange.end;
    }

    return course;
  }

  // ---------- 导入标准作息时间段（必填，用于满足 timeSlots 非空） ----------
  async function importTimeSlots() {
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
      await window.AndroidBridgePromise.savePresetTimeSlots(
        JSON.stringify(timeSlots),
      );
      console.log("时间段数据已导入");
    } catch (e) {
      showToast("时间段导入失败: " + e.message);
    }
  }

  // ---------- 核心：从页面表格解析课程 ----------
  async function parseCoursesFromPage() {
    const table = document.querySelector(".ant-table-content table");
    if (!table) {
      throw new Error("未找到课表表格，请确保已进入课表页面。");
    }

    const theadRow = table.querySelector("thead tr");
    if (!theadRow) {
      throw new Error("表格结构异常，无表头行。");
    }

    // 建立列索引 -> 星期几的映射
    const ths = Array.from(theadRow.querySelectorAll("th"));
    const dayHeaders = ths.slice(2); // 前两列为固定列（空、节次）
    const columnToDay = {};
    const dayMap = {
      星期一: 1,
      星期二: 2,
      星期三: 3,
      星期四: 4,
      星期五: 5,
      星期六: 6,
      星期日: 7,
    };
    dayHeaders.forEach((th, idx) => {
      const text = th.textContent.trim();
      columnToDay[idx] = dayMap[text] || idx + 1;
    });
    const dayCount = dayHeaders.length;

    const rows = Array.from(table.querySelectorAll("tbody tr.ant-table-row"));
    if (rows.length === 0) {
      throw new Error("无课表数据行。");
    }

    const rowspanTracker = new Array(dayCount).fill(null);
    const courses = [];
    const courseSet = new Set();

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const tr = rows[rowIdx];
      const currentSection = rowIdx + 1; // 第一行对应第1节
      const cells = Array.from(tr.children).slice(2); // 跳过固定列

      let colIdx = 0;
      for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
        const td = cells[cellIdx];

        // 跳过因 rowspan 被占用的列
        while (
          colIdx < dayCount &&
          rowspanTracker[colIdx] &&
          rowspanTracker[colIdx].remain > 0
        ) {
          rowspanTracker[colIdx].remain--;
          if (rowspanTracker[colIdx].remain === 0)
            rowspanTracker[colIdx] = null;
          colIdx++;
        }
        if (colIdx >= dayCount) break;

        const rowspan = parseInt(td.getAttribute("rowspan") || "1", 10);
        const endSection = currentSection + rowspan - 1;

        const courseCards = td.querySelectorAll(".course_content_item");
        if (courseCards.length > 0) {
          const cellCourses = [];
          courseCards.forEach((card) => {
            const course = parseCourseCard(
              card,
              columnToDay[colIdx],
              currentSection,
              endSection,
            );
            if (course.name && course.weeks.length && course.customStartTime) {
              cellCourses.push(course);
            }
          });

          if (rowspan > 1) {
            rowspanTracker[colIdx] = {
              remain: rowspan - 1,
              cellData: cellCourses,
            };
          }

          for (const course of cellCourses) {
            const key = `${course.name}|${course.position}|${course.day}|${course.customStartTime}|${course.customEndTime}|${course.weeks.join(",")}`;
            if (!courseSet.has(key)) {
              courseSet.add(key);
              courses.push(course);
            }
          }
        } else {
          if (rowspan > 1) {
            rowspanTracker[colIdx] = { remain: rowspan - 1, cellData: null };
          }
        }
        colIdx++;
      }

      // 继续减少剩余跨行列的计数
      for (; colIdx < dayCount; colIdx++) {
        if (rowspanTracker[colIdx] && rowspanTracker[colIdx].remain > 0) {
          rowspanTracker[colIdx].remain--;
          if (rowspanTracker[colIdx].remain === 0)
            rowspanTracker[colIdx] = null;
        }
      }
    }

    if (courses.length === 0) {
      throw new Error("未提取到任何课程数据，请确认课表已加载。");
    }

    return courses;
  }

  // ---------- 导入课表配置（可选） ----------
  async function importConfig() {
    const config = {
      semesterStartDate: "2026-02-23", // 请按实际校历修改
      semesterTotalWeeks: 20,
      defaultClassDuration: 45,
      defaultBreakDuration: 10,
      firstDayOfWeek: 1,
    };
    try {
      await window.AndroidBridgePromise.saveCourseConfig(
        JSON.stringify(config),
      );
    } catch (e) {
      console.warn("配置导入失败（可忽略）:", e);
    }
  }

  // ---------- 主流程 ----------
  async function runImportFlow() {
    try {
      // 1. 检查是否在课表页面
      if (!document.querySelector(".ant-table-content")) {
        throw new Error("请在课表页面运行此脚本");
      }

      showToast("正在解析课表数据...");

      // 2. 解析课程
      const courses = await parseCoursesFromPage();
      showToast(`解析到 ${courses.length} 门课程，正在保存...`);

      // 3. 保存课程数据
      await window.AndroidBridgePromise.saveImportedCourses(
        JSON.stringify(courses),
      );

      // 4. 导入时间段（即使课程使用自定义时间）
      await importTimeSlots();

      // 5. 导入学期配置
      await importConfig();

      showToast(`导入完成，共 ${courses.length} 门课程`);
      if (
        typeof AndroidBridge !== "undefined" &&
        AndroidBridge.notifyTaskCompletion
      ) {
        AndroidBridge.notifyTaskCompletion();
      }
    } catch (error) {
      console.error(error);
      showToast(`导入失败: ${error.message}`);
      if (typeof window.AndroidBridgePromise !== "undefined") {
        await window.AndroidBridgePromise.showAlert(
          "导入失败",
          error.message,
          "确定",
        );
      }
    }
  }

  // 延迟执行，确保 React 渲染完成
  setTimeout(runImportFlow, 1200);
})();
