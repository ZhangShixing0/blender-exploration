# 模型与运行时的分工

仓库保存当前网页及其输入模型。浏览器使用已导出的 GLB 和 WebP，不会在线启动 Blender。

| 层 | 文件 | 负责什么 |
| --- | --- | --- |
| 基础岛屿 | `scenes/moonlit-harbor-animation-v331-water-contacts.blend` | 地形、房屋、码头与基础水体几何 |
| 引航船 | `scenes/pilot-launch-v336.blend` | 独立船体与船上道具 |
| 守塔人 | `experiments/keeper-a-20261017/keeper-a-neckfix.blend` | 颈部修正版与已认可服装 |
| 渔夫 | `experiments/harbor-cast-20261018/fisher-v3.blend` | 去掉网兜、调整表情的版本 |
| 旅人 | `experiments/harbor-cast-20261018/visitor.blend` | 已选定的旅行者造型 |
| 实时画面 | `web/暮色海港3d/app.js`、`harbor-materials.js` | 水面、昼夜、灯光、相机和色彩 |
| 人物动作 | `harbor-cast.js` | 三个人物加载、地面放置、骨骼招手与钓竿 |
| 结构修复 | `harbor-bench.js`、`harbor-contacts.js` | 长椅避让围栏、清理穿入植物、棚顶横梁和码头支承 |
| 互动与声音 | `harbor-interactions.js`、`harbor-life.js`、`experience.js`、`ambient-audio.js` | 水波、鱼鸟、引航、小雨、声音混合和明信片 |

表中的 JavaScript 文件均位于 `web/暮色海港3d/`。静态物件在修复后合批，原物件仍参与拾取；人物保留可变形骨骼。

## 编辑 Blender 工程

五份工程在 Blender 5.2.2 LTS 中检查并重新保存了发布副本。贴图已打包，图像路径改为相对路径，渲染输出使用 `//renders/preview`；没有覆盖本地原工程。发布副本与原文件的二进制哈希会因这些处理不同。

`assets/cast-v340/manifest.json` 的 `sourceSha256` 记录最初导出时的原工程，`publishedSourceSha256` 记录仓库中的可编辑副本。运行时 GLB 与主工作区当前版本保持一致。

## 重新导出

正常运行网页不需要此步骤。需要重建模型时，在仓库根目录依次执行，`blender` 需替换为自己的可执行程序：

```sh
python -m pip install Pillow
blender -b --python scripts/export_harbor_static_glb_v331.py
blender -b --python scripts/export_harbor_cast_v340.py
python scripts/optimize_harbor_textures.py
```

引航船的程序化源脚本是 `scripts/build_pilot_launch_v336.py`。它会重建并覆盖仓库中的引航船工程，手动改船后不要直接执行；可以自行在 Blender 中导出 GLB。

导出会写入新的 GLB、共享贴图和本地 `checks/` 报告。哈希清单用于锁定此发布快照，资产修改后检查预期会失败；先审阅新画面和依赖，再更新 `asset-manifest.json`。不要用更新哈希代替视觉验证。

这里提供选定源文件的导出链，没有包含早期逐版生成地形、建筑的全部历史脚本。网页外观还取决于运行时修补，因此重新导出基础场景不会自动把网页修补写回 `.blend`。

## 边界

预览服务仅监听本机地址，没有登录、数据库或上传接口。音量偏好使用 localStorage；明信片通过浏览器下载。声音在用户点击后才播放。仓库没有公共部署地址，也没有执行小红书小程序移植。
