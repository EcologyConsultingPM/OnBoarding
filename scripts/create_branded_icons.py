from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
logo_path = ROOT / "public" / "logo.png"

# The leaf/pin symbol occupies the left portion of the existing transparent brand logo.
logo = Image.open(logo_path).convert("RGBA")
mark = logo.crop((0, 0, 258, 257))
mark.thumbnail((360, 360), Image.Resampling.LANCZOS)

canvas = Image.new("RGBA", (512, 512), "#052b20")
# Build a restrained eucalyptus gradient, suitable for 16px as well as large link previews.
pixels = canvas.load()
for y in range(512):
    for x in range(512):
        t = (x + y) / 1022
        pixels[x, y] = (
            int(5 + (14 - 5) * t),
            int(43 + (94 - 43) * t),
            int(32 + (61 - 32) * t),
            255,
        )

# Add a warm-gold ring and an unobtrusive highlight to carry the EC portal palette.
draw = ImageDraw.Draw(canvas)
draw.ellipse((41, 41, 471, 471), fill="#d5b65a")
draw.ellipse((55, 55, 457, 457), fill="#0b4d35")
draw.ellipse((68, 68, 444, 444), fill="#063426")
shine = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
shine_draw = ImageDraw.Draw(shine)
shine_draw.ellipse((-115, -135, 430, 410), fill=(255, 255, 255, 30))
shine = shine.filter(ImageFilter.GaussianBlur(18))
canvas.alpha_composite(shine)

# Centre the existing leaf symbol without changing brand artwork.
left = (512 - mark.width) // 2
upper = (512 - mark.height) // 2
canvas.alpha_composite(mark, (left, upper))

# Export the same deterministic mark to all conventional Next/browser icon locations.
for output in [ROOT / "app" / "icon.png", ROOT / "app" / "apple-icon.png", ROOT / "public" / "apple-icon.png"]:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.name == "apple-icon.png":
        canvas.resize((180, 180), Image.Resampling.LANCZOS).convert("RGBA").save(output, "PNG")
    else:
        canvas.save(output, "PNG")

canvas.convert("RGBA").save(
    ROOT / "public" / "favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

# A branded Open Graph image replaces generic chain-link placeholders in messages.
social = Image.new("RGBA", (1200, 630), "#052b20")
social_pixels = social.load()
for y in range(630):
    for x in range(1200):
        t = (x / 1200) * 0.72 + (y / 630) * 0.28
        social_pixels[x, y] = (
            int(4 + 10 * t),
            int(39 + 59 * t),
            int(29 + 38 * t),
            255,
        )

social_draw = ImageDraw.Draw(social)
social_draw.ellipse((755, -150, 1450, 545), outline="#d5b65a", width=8)
social_draw.ellipse((850, -55, 1250, 345), outline="#4f7c45", width=4)
social_draw.rounded_rectangle((84, 92, 109, 538), radius=12, fill="#d5b65a")

social_logo = logo.copy()
social_logo.thumbnail((690, 198), Image.Resampling.LANCZOS)
social.alpha_composite(social_logo, (150, 212))

social.save(ROOT / "app" / "opengraph-image.png", "PNG")
