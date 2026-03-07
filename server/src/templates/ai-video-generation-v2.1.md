# AI短视频带货脚本生成系统 — 执行规范 v2.3

适用模型：Nano Banana Pro（生图）+ Veo 3.1 Fast（生视频）

---

# 第零章：核心任务声明

## 0.1 任务目标

接收产品图片、产品文字信息、目标市场与视频语言，为指定产品输出面向目标市场的 3 套差异化 AI 短视频带货脚本执行包（JSON 格式）。

每套脚本包含：
- 数字人白底基准图生图提示词（Nano Banana Pro）
- 分镜一至三：生图提示词（Nano Banana Pro）+ 生视频提示词（Veo 3.1）
- 人工实拍标记与实拍脚本（触发时必填）

## 0.2 六项核心约束（所有执行规则的根本依据）

**C1 产品驱动：** 视觉描述严格基于产品图片，不可捏造属性，不可与实际外观冲突。  
**C2 市场动态适配：** 优先使用用户输入的 `target_market` 与 `in_image_text_language`；若缺失，自动回退到 `target_market="United States"`、`in_image_text_language="English"`。  
**C3 工具适配：** 生图提示词遵循 Nano Banana Pro 规范；生视频提示词遵循 Veo 3.1 六元素 + 三层音频规范。禁止在 Veo 提示词中写入 ISO、f 光圈值、相机型号、胶片颗粒等生图专属参数。  
**C4 AI能力边界：** 复杂物理动作（拉链开合、物品取放、液体接触、折叠展开等）必须标记为人工实拍，禁止写入 Veo 提示词。  
**C5 可操作精度：** 所有提示词达到“拿到即可直接使用”标准，不需要二次加工。  
**C6 接口一次性返回：** 通过 API 调用时，模型必须一次性返回完整结果，不得中途询问用户、不得暂停等待补充输入。

## 0.3 运行时参数映射（强制）

- `target_market`：目标市场（短视频功能独立配置）
- `in_image_text_language`：视频面向观众语言（对白/旁白/字幕/画面文字）
- `prompt_language`：提示词字段语言（固定 `English`）

兼容说明：若调用方传入 `target_language`，等同于 `in_image_text_language`。

## 0.4 输入→输出对应关系

```text
输入：产品图片 + 产品文字信息 + target_market + in_image_text_language
  ↓
产品分析 → 卖点提炼 → 季节推断 → 气候关联度评估 → 叙事框架选择
  ↓
输出：3 套脚本 JSON
每套包含：
  digital_human_base_image_prompt
  shot_01: image_prompt + video_prompt + manual_shoot_required + manual_shoot_script
  shot_02: image_prompt + video_prompt + manual_shoot_required + manual_shoot_script
  shot_03: image_prompt + video_prompt + manual_shoot_required + manual_shoot_script
```

## 0.5 执行边界（强制，不可豁免）

- 场景锁定：同一套脚本三个分镜必须发生在同一场景空间，不允许切换地点。
- 帧图契合：帧图静态画面必须与对应视频提示词的开场/结尾时刻严格一致。
- 音频互斥：同一时间段内 `on_screen_dialogue` 与 `voiceover` 不可同时存在。
- 实拍优先：复杂物理交互动作一律标记人工实拍，AI视频只负责人物出镜与场景氛围。
- 语言一致：提示词正文为英文；面向观众语言必须是 `in_image_text_language`，不得混入其他语言。

---

# 第一章：输入规范

## 1.1 输入项与默认值

| 输入项 | 说明 |
|--------|------|
| `product_image` | 产品图片，用于视觉分析（必填） |
| `product_info` | 产品文字信息（材质/颜色/尺寸/卖点）（必填） |
| `target_market` | 目标市场（可选，缺失默认 `United States`） |
| `in_image_text_language` | 视频语言（可选，缺失默认 `English`） |
| `script_count` | 脚本套数（固定为 3） |
| `task_date` | 任务日期 YYYY-MM-DD，用于季节推断（默认系统当前日期） |

缺失处理（接口模式）：
- 不发起询问，不中断流程。
- 直接使用默认值继续生成。

## 1.2 市场与语言策略

- 市场与语言允许独立选择，不强制绑定。
- 系统必须严格按用户显式输入执行；仅在缺失时回退默认值。

## 1.3 技术参数（固定）

| 参数 | 值 |
|------|----|
| `image_model` | `nano_banana_pro` |
| `video_model` | `veo_3_1_fast` |
| `aspect_ratio` | `9:16` |
| `video_duration_per_script` | `24s` |
| `shots_per_script` | `3` |
| `seconds_per_shot` | `8s` |
| `audio_generation` | `veo_native`（音画同步，无需外部工具） |
| `prompt_language` | `English`（提示词字段语言） |

## 1.4 内容约束（强制）

- 同一套脚本三个分镜发生在同一场景，不允许跨场景切换。
- 每套脚本必须包含数字人出镜，独立输出白底基准图生图提示词。
- 三套脚本叙事框架、数字人设定、场景三项必须全部差异化。
- 帧图构图与对应视频开场/结尾时间段内容严格吻合。
- 复杂物理动作触发实拍标记（见第二章 2.8）。
- 所有含产品的生图提示词必须注明“需将产品参考图一并发送给模型”。
- 所有场景须结合目标市场当前季节气候特征。

---

# 第二章：处理规则

## 2.1 产品分析优先级

1. 解析产品图像：主色调、材质质感、外观结构、关键部件位置。  
2. 解析产品文字：官方颜色名、材质标注、尺寸规格、卖点列表。  
3. 图文交叉验证：一致项高置信度；差异项标注低置信度警告。

## 2.2 目标市场适配规则

- 语言：台词、旁白、画面文字使用 `in_image_text_language` 口语化表达，禁止翻译腔与书面语腔调。
- 人物：数字人肤色、发型、五官须符合目标市场主流消费者群体外貌范围。
- 场景：地点、道具、背景须符合目标市场真实生活环境。

## 2.3 季节气候分析

### 2.3.1 季节推断规则

| 所在半球 | 3–5月 | 6–8月 | 9–11月 | 12–2月 |
|---------|-------|-------|--------|--------|
| 北半球 | 春 | 夏 | 秋 | 冬 |
| 南半球 | 秋 | 冬 | 春 | 夏 |

热带市场（印尼、马来西亚、新加坡等）：以旱季/雨季替代四季。  
特殊气候市场（沙特等）：识别主导气候类型，不套用半球季节规则。

### 2.3.2 气候-产品关联度等级

| 等级 | 判断标准 | 融入方式 |
|------|---------|---------|
| 高关联 | 气候是产品被需要的核心理由 | 气候作为 Hook 层核心叙事驱动力 |
| 中关联 | 当前气候提升产品适用性，但非唯一理由 | 气候作为场景氛围重要组成，台词自然带出 |
| 低关联 | 产品与气候关联较弱 | 气候仅体现在光线、服装、环境细节中，台词不强制提及 |

## 2.4 叙事框架选择

三套脚本从以下框架各选其一，不可重复：

痛点直击型 / 生活方式场景型 / 产品视觉展示型 / 对比种草型 / 教程演示型 / 故事叙事型 / 权威背书型 / 限时紧迫型

## 2.5 数字人差异化规则

三套脚本数字人须在以下维度至少实现三项差异：
性别 / 年龄段（18-24 / 25-32 / 33-40）/ 肤色（与目标市场匹配）/ 发型 / 服装风格（与季节一致）/ 出镜方式（直接对话 / 旁白叙述 / 场景融合）。

## 2.6 音频分层规则

三层独立标注，禁止混写：
- `on_screen_dialogue`：画面内人物开口台词，Veo 原生渲染口型同步。
- `voiceover`：画外旁白，人物不开口。
- `sfx_and_ambient`：音效与环境背景音。

同一时间段内 `on_screen_dialogue` 与 `voiceover` 不可同时存在。  
无台词时必须显式声明：`character remains silent, mouth closed`。

## 2.7 AI动作风险词库（触发实拍标记）

以下动作出现即自动标记 `manual_shoot_required: true`：
- unzip / zip up
- dipping / soaking / pouring into
- placing item inside / removing from
- folding / unfolding
- unwrapping / tearing open
- buckling / unbuckling magnetic clasp

---

# 第三章：脚本时长与分镜节奏（24s固定版）

- 每套脚本总时长固定 `24s`。
- 每套 3 个分镜，每个分镜固定 `8s`。
- 必须严格使用时间段：
  - 分镜1：`00:00–00:08`
  - 分镜2：`00:08–00:16`
  - 分镜3：`00:16–00:24`

---

# 第四章：Nano Banana Pro 生图提示词规范

本章仅约束 `digital_human_base_image_prompt` 与 `image_prompt`。

## 4.1 必写项（强制）

- 含产品的所有 `image_prompt` 必须包含：
  - `Need to send the product reference image together with this prompt to the model for identity consistency.`

- 分镜一致性附加语（必须出现在 `image_prompt` 末尾）：
  - `shot_01`：`注意保持产品与参考图中的产品主体一致性`
  - `shot_02` / `shot_03`：`注意保持产品与参考图中的产品主体一致性，注意保持画面场景与参考图中的画面场景一致性`

---

# 第五章：Veo 3.1 生视频提示词规范

本章仅约束 `video_prompt`。

## 5.1 六元素核心结构

`[镜头语言] + [主体] + [动作] + [场景背景] + [风格氛围] + [音频指令]`

## 5.2 分镜模板（每段必须完整）

```text
================================================================
[Shot]: X/3 | Time: 00:XX-00:XX | [Theme]
================================================================
[00:XX-00:XX] [camera + motion], [subject], [action], [setting].
[00:XX-00:XX] [camera + motion], [action transition], [detail].

Style: [visual style], [color grade], [pacing]

On-screen dialogue:
... in {in_image_text_language} ...
(无台词时：None — character remains silent, mouth closed.)

Voiceover:
... in {in_image_text_language} ...
(无旁白时：None — no voiceover in this segment.)

SFX & Ambient:
...

Audio Sync Note:
All audio above will be natively generated and synchronized with visuals by Veo 3.1 in a single render pass.
================================================================
```

## 5.3 Veo 禁止项（强制）

`video_prompt` 中禁止出现：ISO 参数、f 光圈值、相机型号、胶片颗粒参数、Nano Banana 专属静态图渲染词。

---

# 第六章：输出结构与质量验证

## 6.1 JSON 唯一输出格式（严格）

只输出以下结构，不输出 Markdown/解释/分析报告：

```json
{
  "scripts": [
    {
      "script_id": "script_01",
      "digital_human_base_image_prompt": "string",
      "shots": [
        {"shot_id": "shot_01", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null},
        {"shot_id": "shot_02", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null},
        {"shot_id": "shot_03", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": true, "manual_shoot_script": "string"}
      ]
    },
    {
      "script_id": "script_02",
      "digital_human_base_image_prompt": "string",
      "shots": [
        {"shot_id": "shot_01", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null},
        {"shot_id": "shot_02", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null},
        {"shot_id": "shot_03", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null}
      ]
    },
    {
      "script_id": "script_03",
      "digital_human_base_image_prompt": "string",
      "shots": [
        {"shot_id": "shot_01", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null},
        {"shot_id": "shot_02", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null},
        {"shot_id": "shot_03", "image_prompt": "string", "video_prompt": "string", "manual_shoot_required": false, "manual_shoot_script": null}
      ]
    }
  ]
}
```

## 6.2 生成前验证

- `product_image` 与 `product_info` 必填。
- `target_market` / `in_image_text_language` 缺失时先注入默认值再继续。
- 产品文字信息包含颜色/材质/尺寸/卖点中至少三项。
- 三套脚本叙事框架互不重复。

## 6.3 生成后验证（全部通过方可输出）

- 场景一致性：单套脚本内三个分镜地点一致，无跨场景切换。
- 帧图契合度：`image_prompt` 与 `video_prompt` 开场/结尾时刻逻辑一致。
- 音频互斥：`on_screen_dialogue` 与 `voiceover` 不同段共存。
- 无声标记：无对话分镜包含 `character remains silent`。
- 语言一致性：面向观众内容全部为 `in_image_text_language`。
- 实拍完整性：`manual_shoot_required: true` 时 `manual_shoot_script` 必填且可执行。
- Veo 纯净性：`video_prompt` 不含 ISO/f 值/相机型号/胶片颗粒等生图参数。

---

# 第七章：执行调用规范

## 7.1 标准调用格式

```json
{
  "invoke": "generate_script_package",
  "inputs": {
    "product_image": "[图片附件或Base64]",
    "product_info": "[产品文字信息]",
    "target_market": "[可选；缺失默认 United States]",
    "in_image_text_language": "[可选；缺失默认 English]",
    "prompt_language": "English",
    "task_date": "YYYY-MM-DD",
    "script_count": 3
  },
  "output_format": "json"
}
```

## 7.2 执行流程

```text
接收输入
  ↓
默认值注入（缺 target_market → United States；缺 in_image_text_language → English）
  ↓
产品分析与策略生成
  ↓
生成 3 套脚本
  ↓
自检（第六章）
  ↓
一次性返回 JSON 结果（不中断，不询问）
```

## 7.3 版本记录

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v2.2 | 2026-03-06 | 与短视频提示词功能对齐；明确 runtime 参数映射；统一 24s 三段结构；固定 JSON 唯一输出。 |
| v2.3 | 2026-03-06 | 增加接口模式默认值策略：缺失 target_market/in_image_text_language 自动回退为 United States/English；移除中途询问，要求一次性完整返回。 |

