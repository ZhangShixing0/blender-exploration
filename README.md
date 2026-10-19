<div align="center">

# Blender探索 · 暮色海港

[![Version 3.42](docs/badges/version.svg)](package.json)
[![Blender 5.2.2 LTS](docs/badges/blender.svg)](docs/architecture.md)
[![Three.js r185](docs/badges/threejs.svg)](THIRD_PARTY_NOTICES.md)
[![Runtime WebGL 2](docs/badges/webgl.svg)](docs/architecture.md)
[![License All rights reserved](docs/badges/license.svg)](LICENSE)

![暮色海港 v3.42 实际 WebGL 画面的拉近视角：完整灯塔、房屋、码头和透明水体](docs/media/harbor-day.jpg)

<sub>实际网页场景，拉近镜头并隐藏操作控件拍摄。</sub>

**绕着小岛走一走，点起水波，听一会儿海。**

[快速开始](#快速开始) · [可以做什么](#可以做什么) · [模型与工程](docs/architecture.md) · [素材来源](THIRD_PARTY_NOTICES.md)

</div>

> [!NOTE]
> 当前为 **v3.42 本地交互原型**：Blender 场景和人物，加上 Three.js 实时水面、灯光与互动。仓库提供可运行代码和选定的可编辑模型；尚未部署公共网站，也不是已上架的小红书小程序。

## 项目解决什么问题

把 Blender 中只能渲染观看的海港，变成可以在浏览器里走近、触碰和聆听的小世界。这个项目用于探索三维模型怎样转为轻量互动体验，也保留模型源文件供后续继续制作。

## 可以做什么

- **看海港**：拖动旋转、缩放，从全景走近灯塔、咖啡馆和码头，切换白天与夜晚。
- **碰一碰水**：点击水面形成涟漪，观察水下游鱼、海鸥和小船。
- **拜访居民**：守塔人、渔夫、旅人使用三套已选定的人物模型；点击招呼，渔夫可以拿起钓竿。
- **留一会儿**：自由组合海浪、海风、海鸥和小店环境音，收藏组合，设置小憩计时。
- **留下一刻**：灯塔接船、小雨互动、导出当前视角的明信片。

## 快速开始

只看网页需要 **Python 3.10+** 和支持 WebGL 2 的现代浏览器，不需要安装 Blender、Node.js 或 npm 依赖。

```sh
git clone https://github.com/ZhangShixing0/blender-exploration.git
cd blender-exploration
python scripts/serve.py
```

打开 **http://127.0.0.1:8765/**。Windows 也可用 `py`，macOS / Linux 通常使用 `python3`。

端口被其他预览占用时，运行 `python scripts/serve.py --port 8766`，打开对应端口。不要直接双击 HTML；模型与模块需要通过 HTTP 加载。

第一次打开需加载约 30 MB 的场景、人物与共享贴图，时间取决于设备。声音默认关闭，点击底部播放按钮后加载并播放。声音偏好存在本机浏览器，不上传服务器。

## 当前版本

| 内容 | 状态 |
| --- | --- |
| 主网页 | v3.42；保留自然光、昼夜、水体和互动 |
| 人物 | v3.40 网页衍生版：调整腿部比例、骨骼招手及贴图加载 |
| 几何接触 | v3.41 长椅与围栏；v3.42 两座棚顶与八根木柱连接 |
| Blender 源文件 | 海港基础工程、引航船和三个人物，共五份 |

**网页中的材质调整、动态水面、动物路径、长椅与棚顶修补在 JavaScript 中执行。** 打开海港 `.blend` 看到的是基础场景，不包含所有网页效果。详见[模型与运行时的分工](docs/architecture.md)。

## 验证项目

安装 Node.js 后运行以下命令；不需要 `npm install`：

```sh
python scripts/verify_bundle.py
```

检查模型和贴图哈希、GLB 外部依赖、JavaScript 语法及模块引用。`package.json` 仅声明版本和便捷命令，运行时的 Three.js 已随项目提供。本次在本地运行检查，未配置 GitHub Actions。发布副本另做了真实浏览器加载与昼夜切换检查，记录见[发布核验](docs/verification.md)。这些检查不代表全岛所有角度都没有穿模，也不代表已完成手机性能验收。

<details>
<summary>目录与后续修改入口</summary>

```text
web/暮色海港3d/       当前网页、运行时模型、声音、Three.js
scenes/              海港基础场景与引航船 Blender 工程
experiments/         三位居民的已确认 Blender 工程
scripts/             本地预览、包检查、选定模型的导出脚本
docs/                架构、核验、来源与一张真实网页预览
licenses/            第三方许可原文
asset-manifest.json  发布资产的尺寸与 SHA-256
```

原工作区的历史动画、逐帧渲染、旧模型、浏览器缓存和反馈截图没有放进此仓库。五份 Blender 工程的图像已打包；修改模型的方法和导出顺序见[工程说明](docs/architecture.md)。

</details>

## 数据与安全

预览服务只监听本机，不提供登录、上传或数据库接口。声音组合保存在浏览器 localStorage，明信片保存到自己的设备。仓库不包含登录状态、密钥、其他项目资料或历史截图缓存；公共部署需要另行配置正式静态托管。

## 许可

本仓库已公开，原创代码、场景编排和自制服装暂未授予开源许可；参见 [LICENSE](LICENSE)。第三方素材保留各自许可：Three.js、Draco、Quaternius 人物底模、Poly Haven 材质和 Freesound 环境录音的来源与说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。公开可见不等同于 MIT 等开源授权。
