import { useEffect, useRef } from "react";
import { getImage, loadImage } from "../lib/images";
import { tileOrigin, Tileset } from "../lib/types";

/** Small pixel-crisp preview of one tile, or of a block of tiles when cols/rows are given. */
export default function TileThumb({ ts, local, size = 34 }: { ts: Tileset; local: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const cv = ref.current;
      const img = getImage(ts);
      if (!cv || !img || !alive) return;
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      const { sx, sy } = tileOrigin(ts, local);
      const k = Math.min(cv.width / ts.tw, cv.height / ts.th);
      ctx.drawImage(img, sx, sy, ts.tw, ts.th, 0, 0, ts.tw * k, ts.th * k);
    };
    if (getImage(ts)) draw();
    else loadImage(ts).then(draw).catch(() => {});
    return () => {
      alive = false;
    };
  }, [ts, local]);
  return <canvas ref={ref} className="thumb" width={size * 2} height={size * 2} style={{ width: size, height: size }} />;
}
