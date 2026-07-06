import { describe, expect, it } from "vitest";

import type { PhotoManifest } from "~/types/photo";

import {
  calculateGalleryColumnWidth,
  computeMasonryItemHeight,
  computeMasonryLayout,
  createMasonryItems,
  estimatePhotoVirtualRect,
  getMasonryAnimationDelay,
  getMasonryItemKey,
  getPhotoSetKey,
  MasonryHeaderItem,
  resolveAspectRatio,
  resolveEffectiveColumnWidth,
  resolveMasonryColumnCount,
  selectVisibleMasonryCells,
  shouldAnimateMasonryItem,
} from "./gallery-layout";

describe("resolveAspectRatio", () => {
  it("returns the provided aspect ratio when valid", () => {
    expect(resolveAspectRatio({ aspectRatio: 1.5 })).toBe(1.5);
  });

  it("falls back to width/height when aspectRatio is missing", () => {
    expect(resolveAspectRatio({ width: 800, height: 400 })).toBe(2);
  });

  it("returns 1 for zero, NaN, negative, or unusable inputs", () => {
    expect(resolveAspectRatio({ aspectRatio: 0, width: 0, height: 0 })).toBe(1);
    expect(resolveAspectRatio({ aspectRatio: Number.NaN })).toBe(1);
    expect(resolveAspectRatio({ aspectRatio: -2 })).toBe(1);
    expect(resolveAspectRatio({ width: 100, height: 0 })).toBe(1);
    expect(resolveAspectRatio({})).toBe(1);
  });
});

const createPhoto = (id: string, aspectRatio = 1): PhotoManifest =>
  ({
    aspectRatio,
    height: 100,
    id,
    width: 100,
  }) as PhotoManifest;

describe("gallery-layout helpers", () => {
  it("builds stable masonry items and photo set keys", () => {
    const photos = [createPhoto("a"), createPhoto("b")];

    expect(getPhotoSetKey(photos)).toBe(getPhotoSetKey(photos));
    expect(createMasonryItems(photos, true)).toEqual(photos);
    expect(createMasonryItems(photos, false)[0]).toBe(
      MasonryHeaderItem.default,
    );
    expect(getMasonryItemKey(MasonryHeaderItem.default)).toBe("header");
    expect(getMasonryItemKey(photos[0])).toBe("a");
  });

  it("calculates responsive column width from the measured container width", () => {
    // containerWidth 是 Masonry 实测的容器 clientWidth（已扣除页面 padding/滚动条），
    // 不再是 window.innerWidth——函数内部也不再做 -8/-32 的 padding 猜测。
    expect(
      calculateGalleryColumnWidth({
        columns: "auto",
        containerWidth: 2000,
        isMobile: false,
      }),
    ).toBe(250);
    expect(
      calculateGalleryColumnWidth({
        columns: "auto",
        containerWidth: 2500,
        isMobile: false,
      }),
    ).toBe(309);
    expect(
      calculateGalleryColumnWidth({
        columns: 3,
        containerWidth: 900,
        isMobile: false,
      }),
    ).toBeCloseTo(297.33, 2);
  });

  it("estimates virtual photo rect with a desktop header occupying the first column", () => {
    const rect = estimatePhotoVirtualRect({
      headerHeight: 120,
      isMobile: false,
      metrics: {
        columnCount: 2,
        columnGutter: 4,
        columnWidth: 100,
        containerRect: DOMRect.fromRect({
          x: 10,
          y: 20,
          width: 204,
          height: 400,
        }),
        rowGutter: 4,
      },
      photoIndex: 0,
      photos: [createPhoto("a", 2)],
    });

    expect(rect).toEqual({
      borderRadius: 0,
      height: 50,
      left: 114,
      top: 20,
      width: 100,
    });
  });

  it("returns null for an out-of-range photo index", () => {
    const metrics = {
      columnCount: 2,
      columnGutter: 4,
      columnWidth: 100,
      containerRect: DOMRect.fromRect({ x: 0, y: 0, width: 204, height: 400 }),
      rowGutter: 4,
    };
    const photos = [createPhoto("a")];
    expect(
      estimatePhotoVirtualRect({
        headerHeight: 0,
        isMobile: true,
        metrics,
        photoIndex: 1,
        photos,
      }),
    ).toBeNull();
    expect(
      estimatePhotoVirtualRect({
        headerHeight: 0,
        isMobile: true,
        metrics,
        photoIndex: -1,
        photos,
      }),
    ).toBeNull();
  });

  it("keeps first-screen animation decisions pure", () => {
    const photo = createPhoto("a");
    expect(shouldAnimateMasonryItem({ hasAnimated: false, index: 2 })).toBe(
      true,
    );
    expect(shouldAnimateMasonryItem({ hasAnimated: true, index: 2 })).toBe(
      false,
    );
    expect(
      getMasonryAnimationDelay({
        data: photo,
        index: 20,
        shouldAnimate: true,
      }),
    ).toBe(0.3);
  });
});

describe("resolveMasonryColumnCount", () => {
  it("derives column count from container width / column width", () => {
    // (404 + 4) / (100 + 4) = 3.92 -> 3 列
    expect(
      resolveMasonryColumnCount({
        containerWidth: 404,
        columnWidth: 100,
        columnGutter: 4,
      }),
    ).toBe(3);
  });

  it("never returns less than 1 column", () => {
    expect(
      resolveMasonryColumnCount({
        containerWidth: 0,
        columnWidth: 100,
        columnGutter: 4,
      }),
    ).toBe(1);
    expect(
      resolveMasonryColumnCount({
        containerWidth: 50,
        columnWidth: 100,
        columnGutter: 4,
      }),
    ).toBe(1);
  });
});

describe("computeMasonryLayout", () => {
  it("places each item into the shortest column (masonry) and reports total height", () => {
    // 2 列，列宽 100，gutter 0。高度：50,100,30,30
    const { cells, totalHeight, columnCount } = computeMasonryLayout({
      items: [{ h: 50 }, { h: 100 }, { h: 30 }, { h: 30 }],
      columnCount: 2,
      columnWidth: 100,
      columnGutter: 0,
      rowGutter: 0,
      getItemHeight: (item) => item.h,
    });

    expect(columnCount).toBe(2);
    // item0 -> col0 (top0), item1 -> col1 (top0), item2 -> col0 (top50,因 col0=50<col1=100),
    // item3 -> col0 (top80,col0=80<col1=100)
    expect(cells.map((c) => ({ col: c.column, top: c.top }))).toEqual([
      { col: 0, top: 0 },
      { col: 1, top: 0 },
      { col: 0, top: 50 },
      { col: 0, top: 80 },
    ]);
    // 列高：col0 = 50+30+30 = 110, col1 = 100 -> 总高 110
    expect(totalHeight).toBe(110);
  });

  it("applies column and row gutters", () => {
    const { cells } = computeMasonryLayout({
      items: [{ h: 40 }, { h: 40 }],
      columnCount: 2,
      columnWidth: 100,
      columnGutter: 10,
      rowGutter: 6,
      getItemHeight: (item) => item.h,
    });
    expect(cells[1]!.left).toBe(110); // 第二列 left = 100 + 10
  });

  it("falls back to a positive height for invalid item heights", () => {
    const { cells } = computeMasonryLayout({
      items: [{ h: Number.NaN }],
      columnCount: 1,
      columnWidth: 100,
      columnGutter: 0,
      rowGutter: 0,
      getItemHeight: (item) => item.h,
    });
    expect(cells[0]!.height).toBeGreaterThan(0);
  });

  it("quantizes fractional widths/heights/positions to integer pixels", () => {
    // 分数列宽（如 393pt 手机上的 190.5）与分数高度必须整数化：非整数几何会让
    // iOS WebKit 分块光栅化在固定内容位置留下 1 设备像素的横向 hairline。
    const { cells, totalHeight } = computeMasonryLayout({
      items: [{ h: 283.5 }, { h: 126.4 }, { h: 141.75 }],
      columnCount: 2,
      columnWidth: 190.5,
      columnGutter: 4,
      rowGutter: 4,
      getItemHeight: (item) => item.h,
    });
    for (const cell of cells) {
      expect(Number.isInteger(cell.left)).toBe(true);
      expect(Number.isInteger(cell.top)).toBe(true);
      expect(Number.isInteger(cell.width)).toBe(true);
      expect(Number.isInteger(cell.height)).toBe(true);
    }
    expect(Number.isInteger(totalHeight)).toBe(true);
  });
});

describe("computeMasonryItemHeight", () => {
  it("returns the rounded height shared by layout and item rendering", () => {
    expect(computeMasonryItemHeight(189, { aspectRatio: 1.5 })).toBe(126);
    expect(computeMasonryItemHeight(190.5, { aspectRatio: 1.5 })).toBe(127);
    expect(
      Number.isInteger(computeMasonryItemHeight(190.5, { aspectRatio: 1.337 })),
    ).toBe(true);
  });

  it("guards invalid aspect ratios like resolveAspectRatio does", () => {
    expect(computeMasonryItemHeight(200, { aspectRatio: Number.NaN })).toBe(
      200,
    );
    expect(computeMasonryItemHeight(200, {})).toBe(200);
    expect(computeMasonryItemHeight(0.4, { aspectRatio: 1 })).toBe(1); // 最小 1px
  });
});

describe("selectVisibleMasonryCells", () => {
  const cells = [
    { index: 0, column: 0, left: 0, top: 0, width: 100, height: 100 },
    { index: 1, column: 0, left: 0, top: 100, width: 100, height: 100 },
    { index: 2, column: 0, left: 0, top: 2000, width: 100, height: 100 },
  ];

  it("includes only cells intersecting the viewport + overscan band", () => {
    const { visible, startIndex, stopIndex } = selectVisibleMasonryCells({
      cells,
      scrollTop: 0,
      viewportHeight: 150,
      overscanPx: 0,
    });
    // 视口 [0,150]：cell0(0-100) 和 cell1(100-200) 相交；cell2(2000+) 不在
    expect(visible.map((c) => c.index)).toEqual([0, 1]);
    expect(startIndex).toBe(0);
    expect(stopIndex).toBe(1);
  });

  it("pulls in far cells once overscan is large enough", () => {
    const { visible } = selectVisibleMasonryCells({
      cells,
      scrollTop: 0,
      viewportHeight: 150,
      overscanPx: 2000,
    });
    expect(visible.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});

describe("resolveEffectiveColumnWidth", () => {
  // 关键不变量：列宽拉伸后，columnCount 列 + gutters 必须正好等于容器宽 —— 即右侧零空白。
  const fillsExactly = (
    containerWidth: number,
    columnCount: number,
    columnGutter: number,
  ) => {
    const width = resolveEffectiveColumnWidth({
      containerWidth,
      columnCount,
      columnGutter,
      fallbackColumnWidth: 200,
    });
    return columnCount * width + (columnCount - 1) * columnGutter;
  };

  it("stretches columns to fill the container exactly across widths/counts", () => {
    for (const [containerWidth, columnCount] of [
      [382, 2],
      [745, 4],
      [1264, 5],
      [1000, 3],
      [320, 2],
    ] as const) {
      expect(fillsExactly(containerWidth, columnCount, 4)).toBeCloseTo(
        containerWidth,
        5,
      );
    }
  });

  it("works with zero gutter", () => {
    expect(fillsExactly(600, 3, 0)).toBeCloseTo(600, 5);
  });

  it("falls back to the target column width when container width is unknown", () => {
    expect(
      resolveEffectiveColumnWidth({
        containerWidth: 0,
        columnCount: 3,
        columnGutter: 4,
        fallbackColumnWidth: 150,
      }),
    ).toBe(150);
  });

  it("never returns a non-positive width", () => {
    expect(
      resolveEffectiveColumnWidth({
        containerWidth: 4,
        columnCount: 5,
        columnGutter: 10,
        fallbackColumnWidth: 100,
      }),
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("estimatePhotoVirtualRect ≡ computeMasonryLayout (property)", () => {
  // 关键不变量：估算矩形必须与真实布局（VirtualMasonry 里 computeMasonryLayout
  // 的输出）对每张照片逐像素一致——现在由「组合调用同一函数」构造性保证，
  // 这里跨列宽/列数/宽高比全量断言，防止未来又手抄出第二份放置逻辑。
  const aspectRatios = [0.5, 0.75, 1, 1.337, 1.5, 1.777, 2.35, 3];
  const makePhotos = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      createPhoto(`p${i}`, aspectRatios[i % aspectRatios.length]!),
    );

  const cases: {
    columnCount: number;
    columnWidth: number;
    headerHeight: number;
    isMobile: boolean;
  }[] = [
    { columnCount: 1, columnWidth: 320, headerHeight: 0, isMobile: true },
    { columnCount: 2, columnWidth: 190, headerHeight: 0, isMobile: true },
    { columnCount: 3, columnWidth: 150, headerHeight: 0, isMobile: true },
    { columnCount: 2, columnWidth: 300, headerHeight: 240, isMobile: false },
    { columnCount: 4, columnWidth: 251, headerHeight: 173, isMobile: false },
    { columnCount: 5, columnWidth: 205, headerHeight: 320, isMobile: false },
    { columnCount: 8, columnWidth: 233, headerHeight: 96, isMobile: false },
  ];

  it.each(cases)(
    "matches the real layout cell for every photo (%o)",
    ({ columnCount, columnWidth, headerHeight, isMobile }) => {
      const photos = makePhotos(25);
      const columnGutter = 4;
      const rowGutter = 4;
      const containerRect = DOMRect.fromRect({
        x: 16,
        y: 64,
        width: columnCount * columnWidth + (columnCount - 1) * columnGutter,
        height: 800,
      });
      const metrics = {
        columnCount,
        columnGutter,
        columnWidth,
        containerRect,
        rowGutter,
      };

      // 与 MasonryRoot/VirtualMasonry 完全同构的真实布局：
      // 桌面端 header 哨兵在 index 0（其高度来自 measure），照片高度纯计算。
      const items = createMasonryItems(photos, isMobile);
      const layout = computeMasonryLayout({
        items,
        columnCount,
        columnWidth,
        columnGutter,
        rowGutter,
        getItemHeight: (item) =>
          item instanceof MasonryHeaderItem
            ? headerHeight
            : computeMasonryItemHeight(columnWidth, item),
      });

      for (const [photoIndex] of photos.entries()) {
        const cellIndex = isMobile ? photoIndex : photoIndex + 1;
        const cell = layout.cells[cellIndex]!;
        const rect = estimatePhotoVirtualRect({
          headerHeight,
          isMobile,
          metrics,
          photoIndex,
          photos,
        });

        expect(rect).toEqual({
          borderRadius: 0,
          height: cell.height,
          left: containerRect.left + cell.left,
          top: containerRect.top + cell.top,
          width: cell.width,
        });
        // 整数像素几何必须保持（iOS WebKit hairline 缝的根源，见 gallery-layout.ts）。
        expect(Number.isInteger(cell.left)).toBe(true);
        expect(Number.isInteger(cell.top)).toBe(true);
        expect(Number.isInteger(cell.width)).toBe(true);
        expect(Number.isInteger(cell.height)).toBe(true);
      }
    },
  );

  it("holds for fractional column widths too (all-integer outputs)", () => {
    const photos = makePhotos(12);
    const columnWidth = 190.5;
    const columnCount = 2;
    const containerRect = DOMRect.fromRect({
      x: 0,
      y: 0,
      width: 385,
      height: 800,
    });
    const metrics = {
      columnCount,
      columnGutter: 4,
      columnWidth,
      containerRect,
      rowGutter: 4,
    };
    const layout = computeMasonryLayout({
      items: photos,
      columnCount,
      columnWidth,
      columnGutter: 4,
      rowGutter: 4,
      getItemHeight: (item) => computeMasonryItemHeight(columnWidth, item),
    });

    for (const [photoIndex] of photos.entries()) {
      const cell = layout.cells[photoIndex]!;
      const rect = estimatePhotoVirtualRect({
        headerHeight: 0,
        isMobile: true,
        metrics,
        photoIndex,
        photos,
      });
      expect(rect).toEqual({
        borderRadius: 0,
        height: cell.height,
        left: cell.left,
        top: cell.top,
        width: cell.width,
      });
      expect(Number.isInteger(rect!.left)).toBe(true);
      expect(Number.isInteger(rect!.top)).toBe(true);
      expect(Number.isInteger(rect!.width)).toBe(true);
      expect(Number.isInteger(rect!.height)).toBe(true);
    }
  });
});

describe("computeMasonryLayout edge cases", () => {
  it("handles an empty item list", () => {
    const { cells, totalHeight } = computeMasonryLayout({
      items: [],
      columnCount: 3,
      columnWidth: 100,
      columnGutter: 4,
      rowGutter: 4,
      getItemHeight: () => 100,
    });
    expect(cells).toEqual([]);
    expect(totalHeight).toBe(0);
  });

  it("clamps a column count below 1 to a single column", () => {
    const { columnCount, cells } = computeMasonryLayout({
      items: [{ h: 50 }, { h: 50 }],
      columnCount: 0,
      columnWidth: 100,
      columnGutter: 0,
      rowGutter: 0,
      getItemHeight: (item) => item.h,
    });
    expect(columnCount).toBe(1);
    expect(cells.map((c) => c.column)).toEqual([0, 0]);
  });
});
