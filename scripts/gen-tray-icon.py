#!/usr/bin/env python3
"""Gera versões monocromáticas da logo para a barra de menus do macOS."""
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def make_template(size: int) -> Image.Image:
	# Desenha em resolução maior para suavizar as linhas nos tamanhos finais.
	scale = size * 8 / 22
	image = Image.new("RGBA", (size * 8, size * 8))
	draw = ImageDraw.Draw(image)

	def box(bounds, radius, width):
		draw.rounded_rectangle(
			tuple(round(value * scale) for value in bounds),
			radius=round(radius * scale),
			outline="black",
			width=max(1, round(width * scale)),
		)

	box((6, 2, 20, 15), 4, 1.1)
	box((3.5, 4.5, 18, 18), 4, 1.1)
	box((1.5, 7, 16, 20), 3.5, 1.1)
	for x in (4, 6, 8):
		draw.ellipse(tuple(round(value * scale) for value in (x - .55, 8.95, x + .55, 10.05)), fill="black")
	for x in (5, 9):
		for y in (12, 16):
			box((x, y, x + 2.5, y + 2.5), .5, .8)
	return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
	for name, size in (("trayTemplate.png", 22), ("trayTemplate@2x.png", 44)):
		make_template(size).save(ASSETS / name)
		print(f"wrote {ASSETS / name} ({size}x{size})")
