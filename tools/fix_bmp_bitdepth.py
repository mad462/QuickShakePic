from __future__ import annotations

import argparse
import struct
from pathlib import Path
from typing import Iterable


BMP_FILE_HEADER_SIZE = 14
BMP_INFO_HEADER_SIZE = 40
SUPPORTED_INPUT_BIT_DEPTHS = {1, 2, 4, 8, 24}
TARGET_BIT_DEPTH_BY_COLOR_COUNT = {
    2: 1,
    4: 2,
    6: 4,
}


class BmpError(Exception):
    pass


def calc_row_stride(width: int, bits_per_pixel: int) -> int:
    return ((width * bits_per_pixel + 31) >> 5) << 2


def read_palette_entry_count(bit_count: int, clr_used: int) -> int:
    if bit_count > 8:
        return 0
    if clr_used > 0:
        return clr_used
    return 1 << bit_count


def unpack_indexed_row(row_bytes: bytes, width: int, bit_count: int) -> list[int]:
    pixels: list[int] = []

    if bit_count == 8:
        return list(row_bytes[:width])

    if bit_count == 4:
        for byte in row_bytes:
            pixels.append((byte >> 4) & 0x0F)
            if len(pixels) < width:
                pixels.append(byte & 0x0F)
            if len(pixels) >= width:
                break
        return pixels

    if bit_count == 2:
        for byte in row_bytes:
            pixels.append((byte >> 6) & 0x03)
            if len(pixels) < width:
                pixels.append((byte >> 4) & 0x03)
            if len(pixels) < width:
                pixels.append((byte >> 2) & 0x03)
            if len(pixels) < width:
                pixels.append(byte & 0x03)
            if len(pixels) >= width:
                break
        return pixels

    if bit_count == 1:
        for byte in row_bytes:
            for bit_index in range(8):
                pixels.append((byte >> (7 - bit_index)) & 0x01)
                if len(pixels) >= width:
                    return pixels
        return pixels

    raise BmpError(f"Unsupported indexed bit depth: {bit_count}")


def pack_indexed_row(indices: list[int], width: int, bit_count: int, row_stride: int) -> bytes:
    row = bytearray(row_stride)

    if bit_count == 4:
        out_index = 0
        for x in range(0, width, 2):
            left = indices[x] & 0x0F
            right = indices[x + 1] & 0x0F if x + 1 < width else 0
            row[out_index] = (left << 4) | right
            out_index += 1
        return bytes(row)

    if bit_count == 2:
        out_index = 0
        for x in range(0, width, 4):
            packed = 0
            for shift_index in range(4):
                pixel_x = x + shift_index
                pixel_index = indices[pixel_x] & 0x03 if pixel_x < width else 0
                packed |= pixel_index << (6 - shift_index * 2)
            row[out_index] = packed
            out_index += 1
        return bytes(row)

    if bit_count == 1:
        out_index = 0
        for x in range(0, width, 8):
            packed = 0
            for bit_index in range(8):
                pixel_x = x + bit_index
                pixel_index = indices[pixel_x] & 0x01 if pixel_x < width else 0
                packed |= pixel_index << (7 - bit_index)
            row[out_index] = packed
            out_index += 1
        return bytes(row)

    raise BmpError(f"Unsupported output indexed bit depth: {bit_count}")


def read_bmp(path: Path) -> tuple[int, int, list[tuple[int, int, int]], list[list[int]]]:
    data = path.read_bytes()
    if len(data) < BMP_FILE_HEADER_SIZE + BMP_INFO_HEADER_SIZE:
        raise BmpError("File too small to be a BMP")

    if data[:2] != b"BM":
        raise BmpError("Not a BMP file")

    bf_off_bits = struct.unpack_from("<I", data, 10)[0]
    bi_size = struct.unpack_from("<I", data, 14)[0]
    if bi_size < BMP_INFO_HEADER_SIZE:
        raise BmpError(f"Unsupported DIB header size: {bi_size}")

    width = struct.unpack_from("<i", data, 18)[0]
    raw_height = struct.unpack_from("<i", data, 22)[0]
    planes = struct.unpack_from("<H", data, 26)[0]
    bit_count = struct.unpack_from("<H", data, 28)[0]
    compression = struct.unpack_from("<I", data, 30)[0]
    clr_used = struct.unpack_from("<I", data, 46)[0]

    if planes != 1:
        raise BmpError(f"Unsupported planes count: {planes}")
    if compression != 0:
        raise BmpError(f"Compressed BMP is not supported: compression={compression}")
    if bit_count not in SUPPORTED_INPUT_BIT_DEPTHS:
        raise BmpError(f"Unsupported input bit depth: {bit_count}")
    if width <= 0 or raw_height == 0:
        raise BmpError("Invalid BMP dimensions")

    height = abs(raw_height)
    bottom_up = raw_height > 0

    palette: list[tuple[int, int, int]] = []
    palette_entry_count = read_palette_entry_count(bit_count, clr_used)
    if palette_entry_count:
        palette_start = BMP_FILE_HEADER_SIZE + bi_size
        for index in range(palette_entry_count):
            offset = palette_start + index * 4
            blue, green, red, _ = struct.unpack_from("<BBBB", data, offset)
            palette.append((red, green, blue))

    row_stride = calc_row_stride(width, bit_count)
    rows: list[list[int]] = []

    if bit_count == 24:
        for row_index in range(height):
            source_row = height - 1 - row_index if bottom_up else row_index
            row_offset = bf_off_bits + source_row * row_stride
            row_pixels: list[int] = []
            for x in range(width):
                pixel_offset = row_offset + x * 3
                blue, green, red = struct.unpack_from("<BBB", data, pixel_offset)
                row_pixels.append((red << 16) | (green << 8) | blue)
            rows.append(row_pixels)
        return width, height, [], rows

    if not palette:
        raise BmpError("Indexed BMP is missing a palette")

    for row_index in range(height):
        source_row = height - 1 - row_index if bottom_up else row_index
        row_offset = bf_off_bits + source_row * row_stride
        row_bytes = data[row_offset: row_offset + row_stride]
        rows.append(unpack_indexed_row(row_bytes, width, bit_count))

    return width, height, palette, rows


def _parse_rgb_line(line: str) -> tuple[int, int, int] | None:
    s = line.strip()
    if not s:
        return None
    if len(s) == 7 and s[0] == "#":
        try:
            r = int(s[1:3], 16)
            g = int(s[3:5], 16)
            b = int(s[5:7], 16)
            return (r, g, b)
        except ValueError:
            return None
    if s.startswith("#"):
        return None
    parts = [p.strip() for p in s.replace(",", " ").split() if p.strip()]
    if len(parts) != 3:
        return None
    try:
        r, g, b = (int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None
    if not all(0 <= c <= 255 for c in (r, g, b)):
        return None
    return (r, g, b)


def load_reference_palette(path: Path) -> list[tuple[int, int, int]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    colors: list[tuple[int, int, int]] = []
    for line in text.splitlines():
        rgb = _parse_rgb_line(line)
        if rgb is not None:
            colors.append(rgb)
    if not colors:
        raise BmpError(f"No colors found in palette file: {path}")
    return colors


def nearest_palette_index(rgb: tuple[int, int, int], palette: list[tuple[int, int, int]]) -> int:
    r, g, b = rgb
    best_i = 0
    best_d = 1 << 30
    for i, (pr, pg, pb) in enumerate(palette):
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < best_d:
            best_d = d
            best_i = i
    return best_i


def snap_24bit_rows_to_palette(
    rows: list[list[int]], ref_palette: list[tuple[int, int, int]]
) -> list[list[int]]:
    out: list[list[int]] = []
    for row in rows:
        out.append(
            [
                nearest_palette_index(
                    ((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF),
                    ref_palette,
                )
                for v in row
            ]
        )
    return out


def collect_used_colors(
    palette: list[tuple[int, int, int]],
    rows: list[list[int]],
) -> tuple[list[tuple[int, int, int]], list[list[int]]]:
    color_to_index: dict[tuple[int, int, int], int] = {}
    remapped_rows: list[list[int]] = []
    compact_palette: list[tuple[int, int, int]] = []

    for row in rows:
        remapped_row: list[int] = []
        for value in row:
            if palette:
                color = palette[value]
            else:
                color = ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)

            if color not in color_to_index:
                color_to_index[color] = len(compact_palette)
                compact_palette.append(color)
            remapped_row.append(color_to_index[color])
        remapped_rows.append(remapped_row)

    return compact_palette, remapped_rows


def build_bmp(width: int, height: int, palette: list[tuple[int, int, int]], rows: list[list[int]]) -> bytes:
    palette_size = len(palette)
    bit_count = TARGET_BIT_DEPTH_BY_COLOR_COUNT[palette_size]
    row_stride = calc_row_stride(width, bit_count)
    image_size = row_stride * height
    palette_size_bytes = palette_size * 4
    bf_off_bits = BMP_FILE_HEADER_SIZE + BMP_INFO_HEADER_SIZE + palette_size_bytes
    bf_size = bf_off_bits + image_size

    buffer = bytearray(bf_size)
    struct.pack_into("<2sIHHI", buffer, 0, b"BM", bf_size, 0, 0, bf_off_bits)
    struct.pack_into(
        "<IIIHHIIIIII",
        buffer,
        BMP_FILE_HEADER_SIZE,
        BMP_INFO_HEADER_SIZE,
        width,
        height,
        1,
        bit_count,
        0,
        image_size,
        2835,
        2835,
        palette_size,
        palette_size,
    )

    palette_offset = BMP_FILE_HEADER_SIZE + BMP_INFO_HEADER_SIZE
    for index, (red, green, blue) in enumerate(palette):
        struct.pack_into("<BBBB", buffer, palette_offset + index * 4, blue, green, red, 0)

    pixel_offset = bf_off_bits
    for row in reversed(rows):
        packed = pack_indexed_row(row, width, bit_count, row_stride)
        buffer[pixel_offset: pixel_offset + row_stride] = packed
        pixel_offset += row_stride

    return bytes(buffer)


def convert_bmp(path: Path, reference_palette_path: Path | None = None) -> tuple[bool, str]:
    width, height, palette, rows = read_bmp(path)
    if reference_palette_path is not None:
        ref = load_reference_palette(reference_palette_path)
        if palette:
            raise BmpError("Reference palette is only supported for 24-bit BMP inputs (no embedded palette)")
        rows = snap_24bit_rows_to_palette(rows, ref)
        palette = ref
    compact_palette, remapped_rows = collect_used_colors(palette, rows)
    color_count = len(compact_palette)
    target_bit_depth = TARGET_BIT_DEPTH_BY_COLOR_COUNT.get(color_count)

    if target_bit_depth is None:
        return False, f"skip ({color_count} colors not in 2/4/6 mapping)"

    output = build_bmp(width, height, compact_palette, remapped_rows)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_bytes(output)
    temp_path.replace(path)
    return True, f"ok ({color_count} colors -> {target_bit_depth}bpp)"


def iter_bmp_files(directory: Path, recursive: bool = False) -> Iterable[Path]:
    pattern = "**/*.bmp" if recursive else "*.bmp"
    return sorted(path for path in directory.glob(pattern) if path.is_file())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rewrite BMP files in the current directory using 2/4/6-color bit-depth mapping."
    )
    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Directory to scan for BMP files. Defaults to the current directory.",
    )
    parser.add_argument(
        "-r",
        "--recursive",
        action="store_true",
        help="Scan BMP files in subdirectories recursively.",
    )
    parser.add_argument(
        "--palette",
        type=Path,
        metavar="FILE",
        help=(
            "Optional RGB palette file (one color per line: R G B or #RRGGBB; # starts a comment). "
            "For 24-bit BMPs, each pixel is snapped to the nearest palette color before counting colors. "
            "Use when the image is 24 bpp but should only use a fixed set of colors (e.g. anti-aliasing)."
        ),
    )
    args = parser.parse_args()

    directory = Path(args.directory).resolve()
    if not directory.is_dir():
        print(f"[ERROR] Not a directory: {directory}")
        return 1

    bmp_files = list(iter_bmp_files(directory, args.recursive))
    if not bmp_files:
        scope = "directory tree" if args.recursive else "directory"
        print(f"[INFO] No BMP files found in {scope}: {directory}")
        return 0

    converted = 0
    skipped = 0
    failed = 0

    ref_palette = args.palette.resolve() if args.palette else None

    for bmp_path in bmp_files:
        try:
            did_convert, message = convert_bmp(bmp_path, ref_palette)
            if did_convert:
                converted += 1
                print(f"[OK] {bmp_path.relative_to(directory)}: {message}")
            else:
                skipped += 1
                print(f"[SKIP] {bmp_path.relative_to(directory)}: {message}")
        except Exception as error:
            failed += 1
            print(f"[ERROR] {bmp_path.relative_to(directory)}: {error}")

    print(
        f"[DONE] converted={converted} skipped={skipped} failed={failed} directory={directory}"
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
