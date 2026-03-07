const VIDEO_KNOWLEDGE_BLOCKS = {
  A: `【块A：五大基础运镜类型与AI关键词】
1) 推镜头（Push In）：突出产品细节与卖点，强调质感与做工。
关键词：push in, dolly in, close-up reveal, cinematic product focus
2) 拉镜头（Pull Out）：展示场景全貌和使用场景，形成信息递进。
关键词：pull out, dolly out, reveal environment, wide transition
3) 横移镜头（Tracking/Pan）：展示产品不同角度和功能面，适合演示用途。
关键词：tracking shot, lateral move, pan shot, side reveal
4) 升降镜头（Tilt/Crane）：强化空间层次，适合“由局部到整体”。
关键词：tilt up, tilt down, crane up, crane down
5) 环绕镜头（Orbit）：用于高冲击卖点展示与英雄镜头。
关键词：orbit shot, arc shot, 360 rotation, hero product shot
建议：优先让运镜服务卖点表达，不做无意义炫技。`,
  B: `【块B：进阶运镜与情绪效果对照】
进阶类型：
- 仰拍（low angle / tilt up）：力量感、权威感、品质感
- 俯拍（high angle / tilt down）：信息总览、场景交代
- 过肩（over-the-shoulder）：代入用户视角，适合使用演示
- POV（first person view）：沉浸感，强化“我正在使用”
- 微距（macro close-up）：材质纹理、接口工艺、缝线细节
情绪映射建议：
- 热情促销：快节奏横移+推进
- 专业可信：稳镜+慢推+中景特写切换
- 生活方式：跟拍+环境拉远+自然光
注意：同一脚本中运镜节奏应有起伏，避免每段同构。`,
  C: `【块C：Seedance 2.0专项运镜提示词框架与模式】
核心模式：
1) 首帧生视频：适合单方向运动、主体相对稳定的镜头
2) 首尾帧生视频：适合起止状态差异明显、场景切换、景别跨度大的镜头
Seedance提示词建议结构：
[Subject] + [Camera Motion] + [Environment] + [Lighting] + [Style] + [Rhythm]
示例关键词池：
camera slowly pushes in, dynamic lateral tracking, smooth orbit around product,
soft studio lighting, warm social media commercial tone, cinematic detail shot
实操建议：
- 每段镜头只给一个核心运动方向
- 英文提示词尽量动作明确，避免抽象词堆叠
- 前后分镜保持同一视觉风格与色彩体系。`,
  D: `【块D：提示词结构公式与分镜脚本逻辑】
提示词公式（英文）：
Who/What + Action + Where + Camera + Lighting + Mood + Quality Tags
分镜逻辑：
1) 开场吸引（1-2镜）：快速建立产品认知
2) 卖点展开（3-5镜）：材质/功能/场景化价值
3) 信任强化（1镜）：细节、对比、证据化表达
4) 收束转化（1镜）：利益点归纳与行动引导
镜头时长建议：
- 单镜头4-6秒
- 总时长控制35-40秒
- 总镜头7-8段
要求：每段都要明确“运镜意图”，不能只写画面描述。`,
  E: `【块E：完整创作流程（三阶段）】
阶段1 规划：
- 识别目标受众与核心卖点优先级
- 明确视频情绪走向（热情/专业/亲切）
阶段2 生成：
- 先写分镜意图，再写首帧/尾帧提示词，再写运动提示词
- 保证每段独立可执行
阶段3 后期与发布：
- 检查字幕简洁度和口播节奏
- 声音风格与画面节奏对齐
- 形成可逐段执行的操作清单
质量检查：
- 卖点是否覆盖
- 节奏是否递进
- 字幕与口播是否葡萄牙语
- 提示词是否英文且可执行。`,
  F: `【块F：实战案例风格参考】
案例1：汽车广告风格（高冲击）
- 低机位推进 + 环绕 + 高反差光影
- 适用于“速度感、力量感、科技感”
案例2：古风/氛围风格（叙事感）
- 慢推+升降+环境拉远
- 适用于“质感、情绪、故事化表达”
案例3：电商爆款短视频（转化导向）
- 开场特写钩子 + 中段卖点拆解 + 收尾利益点
- 重视字幕可读性与镜头信息密度
迁移原则：
- 可借鉴节奏与运镜，不直接复制题材
- 全程围绕商品卖点服务转化。`
};

const VIDEO_KNOWLEDGE_DEFAULT_BLOCKS = ["A", "C", "D"];

module.exports = {
  VIDEO_KNOWLEDGE_BLOCKS,
  VIDEO_KNOWLEDGE_DEFAULT_BLOCKS
};
