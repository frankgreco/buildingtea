// The ONE module that imports echarts. history.ts reaches it with a dynamic import() only when a
// report with the violation and complaint history renders, so the search page never downloads it.
// Nothing may import it statically: that would put the library in the main chunk.
//
// Registration is modular on purpose: echarts/core plus exactly the bar series, the grid and the
// tooltip those charts use, and the SVG renderer. `import * as echarts from "echarts"` pulls every
// chart type and both renderers for no visible difference. There is no zoom component (each chart
// is twelve months, all in view) and no legend component (the page draws the legend above the
// chart, as the section's filter).
//
// SVG rather than canvas: the plots are small and text-heavy, the SVG renderer is the smaller of the
// two, its text is real text, and it prints sharply.

import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import type { ChartOption } from "./chartOptions";

use([BarChart, GridComponent, TooltipComponent, SVGRenderer]);

/** Everything the page does with a chart: draw it, fit it, clear its tooltip, drop it. */
export interface ChartHandle {
  /** Draw `option`. Series are replaced wholesale (a filter can change how many there are); the rest merges. */
  setOption(option: ChartOption): void;
  /** Fit the container's current size. */
  resize(): void;
  hideTip(): void;
  dispose(): void;
}

/** Mount a chart in `host`. The font is the page's own stack, set as the global text style. */
export function createChart(host: HTMLElement, font: string): ChartHandle {
  const chart = init(host, null, { renderer: "svg" });
  return {
    setOption: (option) => chart.setOption({ textStyle: { fontFamily: font }, ...option } as EChartsCoreOption, { replaceMerge: ["series"] }),
    resize: () => chart.resize({ width: "auto", height: "auto" }),
    hideTip: () => chart.dispatchAction({ type: "hideTip" }),
    dispose: () => chart.dispose(),
  };
}
