import sharp from "sharp";

export const TILE = 3000;
export const OVERLAP = 200;

export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
  png: Buffer;
}

export async function tilePage(pageBuf: Buffer, pageW: number, pageH: number): Promise<Tile[]> {
  const step = TILE - OVERLAP;
  const tiles: Tile[] = [];
  for (let y = 0; y < pageH; y += step) {
    for (let x = 0; x < pageW; x += step) {
      const w = Math.min(TILE, pageW - x);
      const h = Math.min(TILE, pageH - y);
      const png = await sharp(pageBuf)
        .extract({ left: x, top: y, width: w, height: h })
        .png({ compressionLevel: 3 })
        .toBuffer();
      tiles.push({ x, y, width: w, height: h, png });
    }
  }
  return tiles;
}
