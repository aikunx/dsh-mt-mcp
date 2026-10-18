"""按 lib/client.js 的真实布局与样式值渲染设置页面板截图。

数值取自源码：card 圆角 10px / 内边距 14px 16px / 最大宽度 620px，
input 内边距 5px 8px / 圆角 6px，button 内边距 5px 10px。
输出 docs/settings-panel.png。
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 720, 460
BG = (250, 250, 251)
CARD_BG = (255, 255, 255)
BORDER = (210, 210, 214)
TEXT = (32, 33, 36)
MUTED = (110, 112, 118)
WARN = (201, 118, 58)
OK = (47, 111, 79)
INPUT_BG = (244, 244, 246)
BTN_BG = (238, 238, 241)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

f_title = load_font(15)
f_body = load_font(13)
f_small = load_font(12)
f_hint = load_font(11)
f_input = load_font(12)

# 卡片：x 24..696（宽 672，接近 max-width 620 + 内边距）
cx0, cy0, cx1, cy1 = 24, 20, 696, 440
d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=10, fill=CARD_BG, outline=BORDER, width=1)

x = cx0 + 16
y = cy0 + 14
inner_w = (cx1 - 16) - x

# 标题
d.text((x, y), "MT 管理器 MCP", font=f_title, fill=TEXT)
y += 26

# 状态行（已连接）
status = "http://192.168.5.20:8787/mcp · 已连接 · 工具 57 个"
d.text((x, y), status, font=f_small, fill=OK)
y += 22

# 说明块（hint，11px，行高 1.6）
hint = (
    "连接手机上的 MT 管理器：MT 内「侧拉栏 → 工具 → MCP 服务 → 启动」，复制它显示的「局域网地址」"
    "（形如 http://192.168.1.23:8787/mcp，必须带末尾 /mcp）填到下面。"
)
# 手工折行
def wrap(text, font, width):
    lines, cur = [], ""
    for ch in text:
        test = cur + ch
        if d.textlength(test, font=font) > width:
            lines.append(cur)
            cur = ch
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines

for line in wrap(hint, f_hint, inner_w)[:4]:
    d.text((x, y), line, font=f_hint, fill=MUTED)
    y += 17
y += 6

# 字段：MCP 地址
d.text((x, y), "MCP 地址", font=f_small, fill=MUTED)
y += 18
d.rounded_rectangle([x, y, x + inner_w, y + 26], radius=6, fill=INPUT_BG, outline=BORDER, width=1)
d.text((x + 8, y + 6), "http://192.168.5.20:8787/mcp", font=f_input, fill=TEXT)
y += 36

# 字段：令牌
d.text((x, y), "Bearer 令牌（MT 默认不启用认证，留空即可）", font=f_small, fill=MUTED)
y += 18
d.rounded_rectangle([x, y, x + inner_w, y + 26], radius=6, fill=INPUT_BG, outline=BORDER, width=1)
d.text((x + 8, y + 6), "未设置", font=f_input, fill=MUTED)
y += 38

# 按钮行
btn_labels = ["保存并连接", "重新连接", "清除令牌"]
bx = x
for i, label in enumerate(btn_labels):
    tw = d.textlength(label, font=f_input)
    bw = tw + 20
    fill = BTN_BG if i > 0 else (222, 236, 228)
    d.rounded_rectangle([bx, y, bx + bw, y + 26], radius=6, fill=fill, outline=BORDER, width=1)
    d.text((bx + 10, y + 6), label, font=f_input, fill=TEXT)
    bx += bw + 8
y += 38

# 工具列表提示
tools = (
    "已发现的 MT 工具（57）：mcp__mt__mt_apk_workspace_open、mcp__mt__mt_apk_list_available_apks、"
    "mcp__mt__mt_apk_workspace_list、mcp__mt__mt_apk_list、mcp__mt__mt_apk_search…"
)
for line in wrap(tools, f_hint, inner_w)[:2]:
    d.text((x, y), line, font=f_hint, fill=MUTED)
    y += 17
y += 6

# 配置路径
d.text((x, y), r"地址与令牌保存在 C:\Users\user\.dsh\dsh-mt-mcp.json（权限 0600）。", font=f_hint, fill=MUTED)
y += 20

# 操作反馈
d.text((x, y), "[ok] 已保存并连接，发现 57 个 MT 工具。", font=f_small, fill=OK)

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))
png = os.path.join(out_dir, "settings-panel.png")
img.save(png)
print("wrote", png, img.size)
