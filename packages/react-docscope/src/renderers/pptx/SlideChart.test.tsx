import { render, screen } from '@testing-library/react';
import PptxRenderer from './PptxRenderer';
import { OFFICE_PALETTE, SlideChart, niceTicks, toChartModel } from './SlideChart';
import type { PptxElement } from './slideModel';
import { renderRenderer } from '../../../../../tests/setup/renderer-harness';

const series = (key: string, ys: number[]) => ({
  key,
  values: ys.map((y, x) => ({ x: String(x), y })),
  xlabels: { 0: 'Q1', 1: 'Q2', 2: 'Q3' },
});
const chart = (extra: Partial<PptxElement> & Record<string, unknown>): PptxElement =>
  ({
    type: 'chart',
    left: 0,
    top: 0,
    width: 400,
    height: 300,
    chartType: 'barChart',
    data: [series('A', [1, 2, 3]), series('B', [3, 2, 1])],
    colors: [],
    ...extra,
  }) as PptxElement;

describe('toChartModel', () => {
  it('normalizes category series and colours', () => {
    const m = toChartModel(chart({ colors: ['#112233', 'javascript:x'] }), ['#AAAAAA', '#BBBBBB'])!;
    expect(m.kind).toBe('bar');
    expect(m.categories).toEqual(['Q1', 'Q2', 'Q3']);
    expect(m.series.map((s) => s.color)).toEqual(['#112233', '#BBBBBB']);
    expect(m.series[1]!.values).toEqual([3, 2, 1]);
  });

  it('reads direction, grouping, markers and hole size', () => {
    expect(
      toChartModel(chart({ barDir: 'bar', grouping: 'percentStacked' }), OFFICE_PALETTE),
    ).toMatchObject({
      horizontal: true,
      stacking: 'percent',
    });
    expect(
      toChartModel(chart({ chartType: 'lineChart', marker: false }), OFFICE_PALETTE)!.markers,
    ).toBe(false);
    expect(
      toChartModel(chart({ chartType: 'doughnutChart', holeSize: '75' }), OFFICE_PALETTE)!.hole,
    ).toBe(0.75);
    expect(
      toChartModel(chart({ chartType: 'doughnutChart', holeSize: 'x' }), OFFICE_PALETTE)!.hole,
    ).toBe(0.5);
  });

  it('handles scatter data and rejects unsupported or empty charts', () => {
    const m = toChartModel(
      chart({
        chartType: 'scatterChart',
        style: 'lineMarker',
        data: [
          [1, 2],
          [3, Number.NaN],
        ],
      }),
      OFFICE_PALETTE,
    )!;
    expect(m).toMatchObject({ kind: 'scatter', xs: [1, 2], scatterLines: true });
    expect(m.series[0]!.values).toEqual([3, 0]);
    expect(
      toChartModel(chart({ chartType: 'scatterChart', data: [[1]] }), OFFICE_PALETTE),
    ).toBeNull();
    expect(toChartModel(chart({ chartType: 'stockChart' }), OFFICE_PALETTE)).toBeNull();
    expect(toChartModel(chart({ data: [] }), OFFICE_PALETTE)).toBeNull();
    expect(
      toChartModel(chart({ data: [{ key: 'x', values: [], xlabels: {} }] }), OFFICE_PALETTE),
    ).toBeNull();
  });

  it('ignores out-of-range points and names unnamed series', () => {
    const m = toChartModel(
      chart({
        data: [
          {
            values: [
              { x: '0', y: 5 },
              { x: '9', y: 1 },
              { x: '-1', y: 2 },
            ],
          },
        ],
      }),
      [],
    )!;
    expect(m.categories).toHaveLength(10);
    expect(m.series[0]).toMatchObject({ name: 'Series 1', color: OFFICE_PALETTE[0] });
    expect(m.series[0]!.values[0]).toBe(5);
  });
});

describe('niceTicks', () => {
  it('produces round steps covering the range', () => {
    expect(niceTicks(0, 30)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(0, 65)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(-5, 5)).toEqual([-6, -4, -2, 0, 2, 4, 6]);
    expect(niceTicks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(4, 4)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('SlideChart', () => {
  const draw = (el: PptxElement) => render(<SlideChart el={el} style={{}} />);

  it.each([
    ['barChart', { grouping: 'stacked' }, 'Bar chart: A, B', 'rect'],
    ['barChart', { barDir: 'bar', grouping: 'percentStacked' }, 'Bar chart: A, B', 'rect'],
    ['lineChart', { marker: true, grouping: 'stacked' }, 'Line chart: A, B', 'polyline'],
    ['areaChart', { grouping: 'standard' }, 'Area chart: A, B', 'polygon'],
    ['areaChart', { grouping: 'stacked' }, 'Area chart: A, B', 'polygon'],
    ['radarChart', {}, 'Radar chart: A, B', 'polygon'],
    ['pieChart', {}, 'Pie chart: Q1, Q2, Q3', 'path'],
  ])('draws %s %p', (chartType, extra, label, mark) => {
    const { container } = draw(chart({ chartType, ...extra }));
    const svg = screen.getByRole('img', { name: label });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelectorAll(mark).length).toBeGreaterThan(0);
  });

  it('draws a full circle for a single-slice pie and a doughnut hole', () => {
    const { container } = draw(
      chart({ chartType: 'doughnutChart', data: [series('Only', [5, 0, 0])], holeSize: '50' }),
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('draws scatter points, with lines only for line styles', () => {
    const { container, unmount } = draw(
      chart({
        chartType: 'scatterChart',
        data: [
          [1, 2, 3],
          [2, 4, 3],
        ],
      }),
    );
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelector('polyline')).toBeNull();
    unmount();
    const lined = draw(
      chart({
        chartType: 'scatterChart',
        style: 'lineMarker',
        data: [
          [1, 2],
          [2, 4],
        ],
      }),
    );
    expect(lined.container.querySelector('polyline')).not.toBeNull();
  });

  it('formats large values and truncates long legend names', () => {
    draw(
      chart({
        data: [
          series('A very long series name indeed', [12000, 2_500_000, 3]),
          series('B', [1, 1, 1]),
        ],
      }),
    );
    expect(screen.getByText('A very long serie…')).toBeTruthy();
    expect(screen.getByText('2.5M')).toBeTruthy();
    expect(screen.getByText('500k')).toBeTruthy();
  });

  it('falls back to a placeholder for unsupported charts', () => {
    draw(chart({ chartType: 'surfaceChart' }));
    expect(screen.getByText(/surfaceChart.*not rendered/)).toBeTruthy();
  });
});

describe('charts in PptxRenderer', () => {
  it('renders every chart of the fixture as an accessible SVG', async () => {
    const r = renderRenderer(PptxRenderer, { name: 'charts.pptx', fixture: 'charts.pptx' });
    await r.ready();
    const charts = await screen.findAllByRole('img', { name: /chart:/ });
    expect(charts.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Bar chart: North, South, West',
      'Bar chart: North, South, West',
      'Line chart: North, South, West',
      'Area chart: North, South',
      'Pie chart: North, South, West',
      'Pie chart: North, South, West',
      'Scatter chart: Series 1',
      'Radar chart: North, South',
    ]);
  });
});
