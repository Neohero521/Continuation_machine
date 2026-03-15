// 彩云小梦风格小说续写插件核心逻辑
import {
  extension_settings,
  getContext,
  loadExtensionSettings,
} from "../../../extensions.js";

import { saveSettingsDebounced } from "../../../../script.js";

// 插件基础配置（名称需和仓库名完全一致）
const extensionName = "Continuation_machine";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];

// 默认设置 完全匹配UI选项
const defaultSettings = {
  mode: "v_mode",
  functionType: "continuation",
  customPrompt: "",
  length: "200",
  style: "标准",
};

// 全局缓存当前生成的完整结果（卡片只显示预览，这里存完整内容）
let currentFullResults = [];
// 全局缓存当前插入模式
let currentInsertMode = false;

// 加载并初始化插件设置
async function loadSettings() {
  // 初始化设置对象
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  // 同步设置到UI
  const settings = extension_settings[extensionName];
  $(`#cy_${settings.mode}`).prop("checked", true);
  $(`#cy_function_type`).val(settings.functionType);
  $(`#cy_custom_prompt`).val(settings.customPrompt);
  $(`#cy_length_${settings.length}`).prop("checked", true);
  $(`#cy_style`).val(settings.style);

  // 初始化按钮状态
  $("#cy_refresh_btn").prop("disabled", currentFullResults.length === 0);
}

// 设置变更事件处理
function onSettingChange(event) {
  const target = $(event.target);
  const settings = extension_settings[extensionName];

  // 模式切换
  if (target.is("input[name='cy_mode']")) {
    settings.mode = target.val();
  }
  // 功能类型切换
  else if (target.is("#cy_function_type")) {
    settings.functionType = target.val();
  }
  // 自定义指令
  else if (target.is("#cy_custom_prompt")) {
    settings.customPrompt = target.val();
  }
  // 字数选择
  else if (target.is("input[name='cy_length']")) {
    settings.length = target.val();
  }
  // 风格选择
  else if (target.is("#cy_style")) {
    settings.style = target.val();
  }

  saveSettingsDebounced();
}

// 获取编辑器内容和选中文本
function getEditorContent() {
  const textarea = $("#send_textarea")[0];
  if (!textarea) return { fullText: "", selectedText: "", start: 0, end: 0 };

  const fullText = textarea.value || "";
  const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd) || "";
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  return { fullText, selectedText, start, end };
}

// 插入内容到编辑器
function insertContentToEditor(content, isReplaceSelected = false) {
  const textarea = $("#send_textarea")[0];
  if (!textarea) return;

  const { fullText, start, end } = getEditorContent();
  textarea.focus();

  if (isReplaceSelected && start !== end) {
    // 替换选中的内容（扩写/缩写/改写用）
    textarea.value = fullText.substring(0, start) + content + fullText.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + content.length;
  } else {
    // 追加到文末（续写用，和彩云小梦逻辑完全一致）
    textarea.value = fullText + content;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  // 触发编辑器的输入事件，让ST识别内容变化
  $(textarea).trigger("input");
  toastr.success("内容已插入编辑器", "操作成功");
}

// 构建对应功能的Prompt 完全复刻彩云小梦的生成逻辑
function buildPrompt() {
  const settings = extension_settings[extensionName];
  const { fullText, selectedText } = getEditorContent();
  const targetLength = Number(settings.length);

  // 基础参数：根据模式设置温度，V模式严谨/O模式放飞
  const baseTemperature = settings.mode === "v_mode" ? 0.7 : 1.0;
  let prompt = "";
  let isReplaceSelected = false;

  switch (settings.functionType) {
    // 1. 续写功能：接在文末无缝衔接，不重复原文
    case "continuation":
      prompt = `你是专业的网络小说续写助手，严格遵循以下要求创作：
1. 基于用户提供的小说原文，**严格接在原文的最后一句末尾续写**，续写内容和原文无缝衔接，绝对不要重复原文内容，只输出续写的正文，不要任何标题、解释、说明、前缀
2. 续写风格为【${settings.style}】，严格贴合原文的人物设定、故事走向、叙事节奏和语言风格，情节连贯自然，符合逻辑
3. 续写字数严格控制在${targetLength}字左右，误差不超过20字
4. 不要添加任何额外的内容，只输出续写的正文

原文内容：
${fullText}`;
      isReplaceSelected = false;
      break;

    // 2. 扩写功能：丰富选中内容的细节
    case "expand":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要扩写的文本内容", "选中内容为空");
        return null;
      }
      prompt = `你是专业的小说扩写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，进行细节扩写，丰富人物的动作、表情、心理活动、场景描写、对话细节，让内容更生动饱满
2. 扩写风格为【${settings.style}】，严格贴合原文的人物设定、故事背景和语言风格，不要改变原文的核心情节和意思
3. 扩写后的字数控制在${targetLength}字左右，误差不超过20字
4. 只输出扩写后的完整文本，不要任何解释、说明、前缀

要扩写的原文内容：
${selectedText}

上下文参考：
${fullText}`;
      isReplaceSelected = true;
      break;

    // 3. 缩写功能：精简选中的内容
    case "shorten":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要缩写的文本内容", "选中内容为空");
        return null;
      }
      prompt = `你是专业的文本缩写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，进行精简缩写，保留核心情节、关键信息和人物对话的核心意思，去除冗余的修饰和描写
2. 缩写后的内容要逻辑连贯，语句通顺，贴合原文的语言风格
3. 缩写后的字数严格控制在${targetLength}字左右，误差不超过20字
4. 只输出缩写后的完整文本，不要任何解释、说明、前缀

要缩写的原文内容：
${selectedText}`;
      isReplaceSelected = true;
      break;

    // 4. 改写功能：重写选中的内容
    case "rewrite":
      if (!selectedText) {
        toastr.warning("请先在编辑器中选中要改写的文本内容", "选中内容为空");
        return null;
      }
      prompt = `你是专业的小说改写助手，严格遵循以下要求创作：
1. 基于用户选中的文本内容，用【${settings.style}】的风格进行重写，不改变原文的核心情节和关键信息，只改变表达方式、叙事视角、描写风格
2. 改写后的内容要逻辑连贯，语句通顺，符合所选风格的特点
3. 改写后的字数控制在${targetLength}字左右，误差不超过20字
4. 只输出改写后的完整文本，不要任何解释、说明、前缀

要改写的原文内容：
${selectedText}

上下文参考：
${fullText}`;
      isReplaceSelected = true;
      break;

    // 5. 定向续写：自定义指令
    case "custom":
      if (!settings.customPrompt.trim()) {
        toastr.warning("请先输入自定义续写指令", "指令为空");
        return null;
      }
      prompt = `你是专业的小说创作助手，严格遵循用户的自定义指令和以下要求创作：
1. 用户自定义指令：${settings.customPrompt}
2. 基于用户提供的小说原文进行创作，严格贴合原文的人物设定、故事走向和语言风格，逻辑连贯自然
3. 创作风格为【${settings.style}】，字数严格控制在${targetLength}字左右，误差不超过20字
4. 只输出符合要求的正文内容，不要任何解释、说明、前缀

原文内容：
${fullText}`;
      isReplaceSelected = false;
      break;

    default:
      prompt = "";
  }

  // 额外补充自定义指令（所有功能都支持额外要求）
  if (settings.functionType !== "custom" && settings.customPrompt.trim()) {
    prompt += `\n额外要求：${settings.customPrompt}`;
  }

  return { prompt, baseTemperature, isReplaceSelected };
}

// 调用ST内置模型生成单条内容
async function generateSingleContent(prompt, temperature) {
  try {
    const targetLength = Number(extension_settings[extensionName].length);
    const generateParams = {
      temperature: temperature,
      max_new_tokens: Math.ceil(targetLength * 1.8), // 汉字转token预留足够空间
      top_p: extension_settings[extensionName].mode === "v_mode" ? 0.85 : 0.95,
      repetition_penalty: 1.05,
      do_sample: true,
    };

    // 调用SillyTavern内置的生成函数，兼容所有已配置的模型
    const result = await window.generateCompletion(prompt, generateParams);
    // 清理结果：去除多余换行、首尾空格，确保内容干净
    return result.trim().replace(/\n{3,}/g, "\n\n");
  } catch (error) {
    console.error("内容生成失败:", error);
    toastr.error("模型调用失败，请检查你的模型配置和连接", "生成错误");
    return null;
  }
}

// 生成多分支内容（3个不同走向，和彩云小梦完全一致）
async function generateContent() {
  const promptConfig = buildPrompt();
  if (!promptConfig) return; // 校验不通过，直接返回

  const { prompt, baseTemperature, isReplaceSelected } = promptConfig;

  // 更新按钮状态，防止重复点击
  $("#cy_generate_btn").prop("disabled", true).val("生成中...");
  $("#cy_refresh_btn").prop("disabled", true);
  $("#cy_results_container").html(`<div class="cy-loading">正在生成多分支内容，请稍候...</div>`);

  try {
    // 生成3个不同温度的结果，实现差异化走向
    const generateTasks = [
      generateSingleContent(prompt, baseTemperature - 0.1), // 更稳定保守
      generateSingleContent(prompt, baseTemperature), // 平衡适中
      generateSingleContent(prompt, baseTemperature + 0.1), // 更放飞脑洞
    ];

    const results = await Promise.all(generateTasks);
    // 过滤失败的结果
    currentFullResults = results.filter(item => item !== null && item.trim() !== "");
    currentInsertMode = isReplaceSelected;

    if (currentFullResults.length === 0) {
      $("#cy_results_container").html(`<div class="cy-empty-tip">生成失败，请检查模型配置后重试</div>`);
      return;
    }

    // 渲染结果卡片
    renderResultCards();
    toastr.success(`成功生成${currentFullResults.length}条内容`, "生成完成");
  } catch (error) {
    console.error("批量生成失败:", error);
    $("#cy_results_container").html(`<div class="cy-empty-tip">生成失败，请重试</div>`);
  } finally {
    // 恢复按钮状态
    $("#cy_generate_btn").prop("disabled", false).val("AI继续");
    $("#cy_refresh_btn").prop("disabled", currentFullResults.length === 0);
  }
}

// 渲染结果卡片 完全复刻彩云小梦的卡片样式
function renderResultCards() {
  const container = $("#cy_results_container");
  container.empty();

  currentFullResults.forEach((content, index) => {
    // 预览内容取前60字，超出用省略号，和原版完全一致
    const previewContent = content.length > 60 ? content.substring(0, 60) + "..." : content;
    const card = $(`
      <div class="cy-result-card">
        <div class="cy-result-preview">${previewContent}</div>
        <input class="menu_button cy-use-btn" type="submit" value="使用" data-index="${index}" />
      </div>
    `);
    container.append(card);
  });

  // 绑定使用按钮事件
  $(".cy-use-btn").on("click", (event) => {
    const index = $(event.target).data("index");
    const selectedContent = currentFullResults[index];
    if (selectedContent) {
      insertContentToEditor(selectedContent, currentInsertMode);
    }
  });
}

// 插件加载入口
jQuery(async () => {
  // 加载UI模板
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
  // 插入到ST的扩展设置面板
  $("#extensions_settings").append(settingsHtml);

  // 绑定所有事件
  $("input[name='cy_mode']").on("change", onSettingChange);
  $("#cy_function_type").on("change", onSettingChange);
  $("#cy_custom_prompt").on("input", onSettingChange);
  $("input[name='cy_length']").on("change", onSettingChange);
  $("#cy_style").on("change", onSettingChange);

  // 按钮点击事件
  $("#cy_generate_btn").on("click", generateContent);
  $("#cy_refresh_btn").on("click", generateContent);

  // 加载设置
  await loadSettings();
});
