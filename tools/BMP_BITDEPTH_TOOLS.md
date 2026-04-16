# BMP 位深批量转换工具

本工具用于把 BMP 图片按实际颜色数重写为设备更容易读取的未压缩索引 BMP，并覆盖原文件。

## 转换规则

- `2 色` -> `1bpp`
- `4 色` -> `2bpp`
- `6 色` -> `4bpp`

其他颜色数量会跳过，不会修改。

## 文件说明

- `fix_bmp_bitdepth.py`：Python 转换脚本
- `fix_bmp_bitdepth.bat`：Windows 双击运行脚本

## 双击使用

双击运行：

```text
fix_bmp_bitdepth.bat
```

它会递归扫描当前项目目录及所有子目录里的 `.bmp` 文件，转换符合规则的图片，并覆盖原图。

## 命令行使用

只处理当前目录：

```powershell
python fix_bmp_bitdepth.py .
```

递归处理当前目录和所有子目录：

```powershell
python fix_bmp_bitdepth.py . --recursive
```

处理指定目录：

```powershell
python fix_bmp_bitdepth.py D:\your\bmp\folder --recursive
```

## 注意事项

- 脚本会覆盖原图，请先备份重要文件。
- 只支持未压缩 BMP，压缩 BMP 会跳过并报错。
- 支持读取 `1bpp / 2bpp / 4bpp / 8bpp / 24bpp` 输入。
- 输出始终是未压缩 BMP，`biCompression = 0`。
