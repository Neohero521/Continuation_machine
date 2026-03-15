// 严格遵循SillyTavern官方模板导入规范
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
} from "../../../extensions.js";

import { saveSettingsDebounced } from "../../../../script.js";

// 严格和官方模板一致的变量定义（必须和插件文件夹名称完全一致）
const extensionName = "Continuation_machine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 默认设置
const defaultSettings = {
  syncStContent: true,
  inheritStParams: true,
  currentFunction: "continuation",
  currentMode: "v_mode",
  currentStyle: "标准",
  currentLength: "200",
  customPrompt: "",
  savedStory: {
    title: "",
    chapter: "",
    content: "",
  },
};

// 全局状态变量
let currentMainContinuation = null; // 当前生成的主续写内容
let currentBranchResults = []; // 底部3条分支内容
let isGenerating = false;
let syncDebounceTimer = null;

// ==============================================
// 严格和官方模板一致的设置加载函数
// ==============================================
async function loadSettings() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  const settings = extension_settings[extensionName];

  // 同步设置到UI
  $("#sync_st_content").prop("checked", settings.syncStContent).trigger("input");
  $("#inherit_st_params").prop("checked", settings.inheritStParams).trigger("input");
  $(`#${settings.currentMode}`).prop("checked", true);
  $("#xiaomeng_style_select").val(settings.currentStyle);
  $("#xiaomeng_length_select").val(settings.currentLength);
  $("#xiaomeng_custom_prompt").val(settings.customPrompt);
  updateFunctionButtonText(settings.currentFunction);

  // 恢复已保存的故事内容
  if (settings.savedStory) {
    $("#xiaomeng_editor_title").val(settings.savedStory.title || "");
    $("#xiaomeng_editor_chapter").val(settings.savedStory.chapter || "");
    $("#xiaomeng_editor_textarea").html(settings.savedStory.content || "");
  }
}

// ==============================================
// 工具函数
// ==============================================
// 更新功能按钮文本
function updateFunctionButtonText(functionType) {
  const functionNameMap = {
    continuation: "续写",
    expand: "扩写",
    shorten: "缩写",
    rewrite: "改写",
    custom: "定向续写",
  };
  $("#function_toggle_btn span").text(functionNameMap[functionType] || "续写");
}

// 获取编辑器纯文本内容
function getEditorPlainText() {
  return $("#xiaomeng_editor_textarea").text().trim() || "";
}

// 获取编辑器选中内容
function getEditorSelectedText() {
  const selection = window.getSelection();
  return selection.toString().trim() || "";
}

// 保存当前故事内容
function saveCurrentStory() {
  extension_settings[extensionName].savedStory = {
    title: $("#xiaomeng_editor_title").val() || "",
    chapter: $("#xiaomeng_editor_chapter").val() || "",
    content: $("#xiaomeng_editor_textarea").html() || "",
  };
  saveSettingsDebounced();
}

// 内容双向同步
function syncContent(direction = "editor-to-st") {
  const settings = extension_settings[extensionName];
  if (!settings.syncStContent) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    if (direction === "editor-to-st") {
      const editorText = getEditorPlainText();
      $("#send_textarea").val(editorText).trigger("input");
    } else {
      const stText = $("#send_textarea").val() || "";
      $("#xiaomeng_editor_textarea").text(stText);
    }
    saveCurrentStory();
  }, 300);
}

// ==============================================
// 核心：调用SillyTavern父级原生API生成内容
// ==============================================
async function generateSingleContent(prompt, generateParams) {
  try {
    // 完全复用SillyTavern父级原生API，无任何修改
    const rawResult = await window.generateCompletion(prompt, generateParams);
    return rawResult.trim().replace(/\n{3,}/g, "\n\n").replace(/^["']|["']$/g, "");
  } catch (error) {
    console.error("ST父级API调用失败:", error);
    toastr.error(`生成失败: ${error.message || "请检查ST API连接状态"}`, "错误");
    return null;
  }
}

// 构建Prompt与生成参数
function buildGenerateConfig(isBranch = false) {
  const settings = extension_settings[extensionName];
  const fullText = getEditorPlainText();
  const selectedText = getEditorSelectedText();
  const targetLength = Number($("#xiaomeng_length_select").val());
  const style = $("#xiaomeng_style_select").val();
  const mode = $("input[name='editor_mode']:checked").val();
  const functionType = settings.currentFunction;
  const customPrompt = $("#xiaomeng_custom_prompt").val().trim();

  // V/O模式参数
  const baseParams = mode === "v_mode" 
    ? { temperature: 0.7, top_p: 0.85, repetition_penalty: 1.1 }
    : { temperature: 1.0, top_p: 0.95, repetition_penalty: 1.05 };

  // 继承ST全局参数
  if (settings.inheritStParams) {
    const stContext = getContext();
    Object.assign(baseParams, {
      temperature: stContext.state.temperature,
      top_p: stContext.state.top_p,
      repetition_penalty: stContext.state.repetition_penalty,
    });
  }

  // 分支内容增加随机性
  if (isBranch) {
    baseParams.temperature = Math.min(1.5, baseParams.temperature + 0.2);
  }

  // 构建Prompt
  let prompt = "";
  switch (functionType) {
    case "continuation":
      prompt = `你是专业的网络小说续写助手，严格接在原文末尾续写，不重复原文，风格【${style}】，字数${targetLength}字左右，只输出续写正文，不要任何额外内容。小说原文：${fullText}`;
      break;
    case "expand":
      if (!selectedText) {
        toastr.warning("请先选中要扩写的内容", "提示");
        return null;
      }
      prompt = `你是专业的小说扩写助手，丰富选中内容的细节，风格【${style}】，字数${targetLength}字左右，只输出扩写后的内容。原文：${selectedText} 上下文：${fullText}`;
      break;
    case "shorten":
      if (!selectedText) {
        toastr.warning("请先选中要缩写的内容", "提示");
        return null;
      }
      prompt = `你是专业的文本缩写助手，精简选中内容，保留核心信息，字数${targetLength}字左右，只输出缩写后的内容。原文：${selectedText}`;
      break;
    case "rewrite":
      if (!selectedText) {
        toastr.warning("请先选中要改写的内容", "提示");
        return null;
      }
      prompt = `你是专业的小说改写助手，用【${style}】风格重写选中内容，不改变核心情节，字数${targetLength}字左右，只输出改写后的内容。原文：${selectedText}`;
      break;
    case "custom":
      if (!customPrompt) {
        toastr.warning("请先输入自定义指令", "提示");
        return null;
      }
      prompt = `你是专业的小说创作助手，遵循指令：${customPrompt}，风格【${style}】，字数${targetLength}字左右，只输出正文内容。原文：${fullText}`;
      break;
  }

  if (functionType !== "custom" && customPrompt) {
    prompt += `\n额外要求：${customPrompt}`;
  }

  return {
    prompt,
    generateParams: {
      ...baseParams,
      max_new_tokens: Math.ceil(targetLength * 2),
      stop: ["\n\n\n", "###", "原文："],
    },
  };
}

// ==============================================
// 核心交互逻辑 1:1还原彩云小梦
// ==============================================
// 主AI续写逻辑（点击AI继续触发）
async function runMainContinuation() {
  if (isGenerating) return;
  const config = buildGenerateConfig(false);
  if (!config) return;

  isGenerating = true;
  $("#float_ai_continue_btn").prop("disabled", true).addClass("loading");
  $("#action_ai_continue_main").prop("disabled", true).text("生成中...");
  $("#results_cards_container").html(`<div class="empty-result-tip">正在生成内容，请稍候...</div>`);

  try {
    // 并行生成1条主内容 + 3条分支内容，完全对齐截图效果
    const generateTasks = [
      generateSingleContent(config.prompt, config.generateParams), // 主内容
      generateSingleContent(config.prompt, { ...config.generateParams, temperature: Math.max(0.5, config.generateParams.temperature - 0.2) }),
      generateSingleContent(config.prompt, { ...config.generateParams, temperature: config.generateParams.temperature + 0.1 }),
      generateSingleContent(config.prompt, { ...config.generateParams, temperature: Math.min(1.5, config.generateParams.temperature + 0.3) }),
    ];

    const results = await Promise.all(generateTasks);
    const mainContent = results[0];
    const branchResults = results.slice(1).filter(item => item !== null && item.trim() !== "");

    if (!mainContent) {
      toastr.error("主内容生成失败，请重试", "错误");
      return;
    }

    // 1. 把主内容用红色标红，插入到编辑器末尾
    currentMainContinuation = mainContent;
    const continuationHtml = `<span class="continuation-red-text">${mainContent}</span>`;
    const editor = $("#xiaomeng_editor_textarea");
    editor.html(editor.html() + continuationHtml);

    // 2. 显示操作栏，隐藏悬浮AI按钮
    $("#continuation_action_bar").show();
    $("#float_ai_continue_btn").hide();

    // 3. 渲染底部3条分支卡片
    currentBranchResults = branchResults;
    renderBranchCards();

    // 4. 滚动到编辑器底部
    const editorMain = $(".xiaomeng-editor-main")[0];
    editorMain.scrollTop = editorMain.scrollHeight;

    toastr.success("续写内容已生成", "完成");
  } catch (error) {
    console.error("续写失败:", error);
    $("#results_cards_container").html(`<div class="empty-result-tip">生成失败，请重试</div>`);
  } finally {
    isGenerating = false;
    $("#float_ai_continue_btn").prop("disabled", false).removeClass("loading");
    $("#action_ai_continue_main").prop("disabled", false).text("Ai 继续");
    $("#refresh_results_btn").prop("disabled", currentBranchResults.length === 0);
  }
}

// 渲染底部分支卡片 1:1还原截图
function renderBranchCards() {
  const container = $("#results_cards_container");
  container.empty();

  currentBranchResults.forEach((content, index) => {
    const previewContent = content.length > 60 ? content.substring(0, 60) + "..." : content;
    const card = $(`
      <div class="result-card">
        <span class="new-tag">New</span>
        <div class="card-preview-text">${previewContent}</div>
        <button class="card-use-btn" data-index="${index}">使用</button>
      </div>
    `);
    container.append(card);
  });

  // 绑定使用按钮事件
  $(".card-use-btn").on("click", (event) => {
    const index = $(event.target).data("index");
    const selectedContent = currentBranchResults[index];
    if (!selectedContent) return;

    // 替换当前的红色续写内容
    currentMainContinuation = selectedContent;
    $(".continuation-red-text").last().html(selectedContent);
    
    // 滚动到对应位置
    const editorMain = $(".xiaomeng-editor-main")[0];
    editorMain.scrollTop = editorMain.scrollHeight;

    toastr.success("已替换为选中的续写内容", "操作成功");
  });
}

// 换一批分支内容
async function refreshBranchResults() {
  if (isGenerating) return;
  const config = buildGenerateConfig(true);
  if (!config) return;

  isGenerating = true;
  $("#refresh_results_btn").prop("disabled", true).text("换一批中...");
  $("#results_cards_container").html(`<div class="empty-result-tip">正在重新生成分支内容...</div>`);

  try {
    // 重新生成3条分支内容
    const generateTasks = [
      generateSingleContent(config.prompt, { ...config.generateParams, temperature: Math.max(0.5, config.generateParams.temperature - 0.2) }),
      generateSingleContent(config.prompt, { ...config.generateParams, temperature: config.generateParams.temperature + 0.1 }),
      generateSingleContent(config.prompt, { ...config.generateParams, temperature: Math.min(1.5, config.generateParams.temperature + 0.3) }),
    ];

    const results = await Promise.all(generateTasks);
    currentBranchResults = results.filter(item => item !== null && item.trim() !== "");

    if (currentBranchResults.length === 0) {
      $("#results_cards_container").html(`<div class="empty-result-tip">生成失败，请重试</div>`);
      return;
    }

    renderBranchCards();
    toastr.success("分支内容已刷新", "完成");
  } catch (error) {
    console.error("换一批失败:", error);
    $("#results_cards_container").html(`<div class="empty-result-tip">生成失败，请重试</div>`);
  } finally {
    isGenerating = false;
    $("#refresh_results_btn").prop("disabled", false).html(`<i class="fa-solid fa-rotate-right"></i> 换一批`);
  }
}

// 操作栏按钮逻辑
// 撤回：删除当前红色续写内容，隐藏操作栏，恢复悬浮按钮
function undoContinuation() {
  $(".continuation-red-text").last().remove();
  $("#continuation_action_bar").hide();
  $("#float_ai_continue_btn").show();
  currentMainContinuation = null;
  currentBranchResults = [];
  $("#results_cards_container").html(`<div class="empty-result-tip">点击「Ai 继续」生成多分支内容</div>`);
  $("#refresh_results_btn").prop("disabled", true);
}

// 修改：选中当前红色续写内容
function modifyContinuation() {
  const continuationElement = $(".continuation-red-text").last()[0];
  if (!continuationElement) return;

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(continuationElement);
  selection.removeAllRanges();
  selection.addRange(range);
  $("#xiaomeng_editor_textarea").focus();
}

// 保存：把红色续写内容转为黑色原文，锁定，隐藏操作栏
function saveContinuation() {
  const continuationElement = $(".continuation-red-text").last();
  if (!continuationElement.length) return;

  // 把span标签替换成纯文本，转为黑色原文
  const textContent = continuationElement.text();
  continuationElement.replaceWith(textContent);
  
  // 隐藏操作栏，恢复悬浮按钮
  $("#continuation_action_bar").hide();
  $("#float_ai_continue_btn").show();
  
  // 清空当前续写状态
  currentMainContinuation = null;
  saveCurrentStory();
  
  toastr.success("续写内容已保存为正文", "保存成功");
}

// ==============================================
// 严格和官方模板一致的jQuery入口函数
// ==============================================
jQuery(async () => {
  // 第一步：加载HTML文件
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
  // 第二步：插入到ST固定容器
  $("#extensions_settings").append(settingsHtml);

  // 第三步：绑定事件
  // 扩展面板事件
  $("#open_xiaomeng_editor").on("click", () => {
    $("#xiaomeng_full_editor").addClass("show");
    $("#xiaomeng_editor_textarea").focus();
  });
  $("#close_editor_btn").on("click", () => {
    $("#xiaomeng_full_editor").removeClass("show");
    syncContent("editor-to-st");
    saveCurrentStory();
  });
  $("#sync_st_content").on("input", (event) => {
    extension_settings[extensionName].syncStContent = Boolean($(event.target).prop("checked"));
    saveSettingsDebounced();
  });
  $("#inherit_st_params").on("input", (event) => {
    extension_settings[extensionName].inheritStParams = Boolean($(event.target).prop("checked"));
    saveSettingsDebounced();
  });

  // 模式与功能切换
  $("input[name='editor_mode']").on("change", (event) => {
    extension_settings[extensionName].currentMode = $(event.target).val();
    saveSettingsDebounced();
  });
  $("#function_toggle_btn").on("click", () => $("#function_dropdown").toggleClass("show"));
  $(document).on("click", (e) => {
    if (!$(e.target).closest("#function_drawer_wrapper").length) {
      $("#function_dropdown").removeClass("show");
    }
  });
  $(".dropdown-item").on("click", (e) => {
    const functionType = $(e.currentTarget).data("function");
    extension_settings[extensionName].currentFunction = functionType;
    saveSettingsDebounced();
    updateFunctionButtonText(functionType);
    $("#function_dropdown").removeClass("show");
  });

  // 核心AI续写事件
  $("#float_ai_continue_btn").on("click", runMainContinuation);
  $("#action_ai_continue_main").on("click", runMainContinuation);
  $("#refresh_results_btn").on("click", refreshBranchResults);

  // 操作栏按钮事件
  $("#action_undo").on("click", undoContinuation);
  $("#action_modify").on("click", modifyContinuation);
  $("#action_save").on("click", saveContinuation);

  // 设置同步事件
  $("#xiaomeng_style_select").on("change", (event) => {
    extension_settings[extensionName].currentStyle = $(event.target).val();
    saveSettingsDebounced();
  });
  $("#xiaomeng_length_select").on("change", (event) => {
    extension_settings[extensionName].currentLength = $(event.target).val();
    saveSettingsDebounced();
  });
  $("#xiaomeng_custom_prompt").on("input", (event) => {
    extension_settings[extensionName].customPrompt = $(event.target).val();
    saveSettingsDebounced();
  });

  // 内容同步事件
  $("#xiaomeng_editor_textarea").on("input", () => syncContent("editor-to-st"));
  $("#send_textarea").on("input", () => syncContent("st-to-editor"));

  // 标题/章节保存
  $("#xiaomeng_editor_title, #xiaomeng_editor_chapter").on("input", saveCurrentStory);

  // ESC键关闭编辑器
  $(document).on("keydown", (e) => {
    if (e.key === "Escape" && $("#xiaomeng_full_editor").hasClass("show")) {
      $("#xiaomeng_full_editor").removeClass("show");
      syncContent("editor-to-st");
      saveCurrentStory();
    }
  });

  // 第四步：加载设置
  loadSettings();
});
