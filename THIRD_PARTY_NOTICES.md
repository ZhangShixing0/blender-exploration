# 第三方素材与依赖

原创代码及编排的保留权利声明不会改变下列组件本身的授权。

| 内容 | 来源与许可 | 使用范围 |
| --- | --- | --- |
| Three.js r185 | [官方仓库](https://github.com/mrdoob/three.js/tree/r185)，[MIT 原文](licenses/Three.js-MIT.txt) | 本地模块、加载器、相机控制与工具 |
| Draco 解码器 | [Google Draco](https://github.com/google/draco)，[许可原文](licenses/Draco-LICENSE.txt) | Three.js 分发中的 glTF 压缩解码 JS/WASM |
| Universal Base Characters Standard | [Quaternius](https://quaternius.com/packs/universalbasecharacters.html)，[随包 CC0 声明](licenses/Quaternius-Standard.txt) | 三位居民的底模、骨骼与部分皮肤/头发贴图；服装与角色调整为项目制作 |
| 岩石、灰泥、木板材质 | [Poly Haven](https://polyhaven.com/license)，CC0 | `rock_face_03`、`plastered_wall`、`weathered_brown_planks`；部分烘焙并转为 WebP |
| 环境声音 | [Freesound 来源记录](web/暮色海港3d/assets/audio/sources.json)，CC0 1.0 | 以下四个本地 MP3 预览文件 |

## 环境录音

- 海浪：[Andy_Gardner / Waves / 127802](https://freesound.org/people/Andy_Gardner/sounds/127802/)。
- 海风：[fthgurdy / Gentle wind / 528944](https://freesound.org/people/fthgurdy/sounds/528944/)。
- 海鸥：[NachtmahrTV / Seagulls / 553235](https://freesound.org/people/NachtmahrTV/sounds/553235/)。
- 小店：[priesjensen / People talking at cafe ambience / 482990](https://freesound.org/people/priesjensen/sounds/482990/)。

播放时做了循环衔接、音量与音色处理。水滴、短汽笛与小雨由 Web Audio 合成。声音组合、收藏和休息计时的交互思路参考 [Moodist](https://github.com/remvze/moodist)，没有使用其音频或源代码。

保留的出处清单：[Poly Haven 文件记录](docs/sources/polyhaven.json)、[Quaternius 来源](docs/sources/quaternius.json)、[声音与 SHA-256](web/暮色海港3d/assets/audio/sources.json)。

## 参考与展示边界

设计过程参考过海边微缩场景和其他作品截图；这些第三方截图、视频及社交网站内容没有复制到仓库。README 图片为本项目实际网页截图，不是概念图。当前分发的模型基于项目场景及上述授权素材。
