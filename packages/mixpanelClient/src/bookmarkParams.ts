import type { IFunnelsReportPlan, IInsightsReportPlan, IReportPlan } from "./types.js";

const DEFAULT_LOOKBACK_DAYS = 30;

export const buildRelativeTimeSection = (
  lastDays = DEFAULT_LOOKBACK_DAYS,
  unit = "day",
): Array<Record<string, unknown>> => [
  {
    dateRangeType: "in the last",
    unit,
    window: {
      unit: "day",
      value: lastDays,
    },
  },
];

export const buildInsightsBookmarkParams = (
  plan: IInsightsReportPlan,
): Record<string, unknown> => {
  const group = plan.breakdown
    ? [
        {
          value: plan.breakdown,
          propertyName: plan.breakdown,
          resourceType: "events",
          propertyType: "string",
          propertyDefaultType: "string",
        },
      ]
    : [];

  return {
    sections: {
      show: [
        {
          type: "metric",
          behavior: {
            type: "event",
            name: plan.event,
            resourceType: "events",
            filtersDeterminer: "all",
            filters: [],
          },
          measurement: {
            math: "general",
          },
        },
      ],
      time: buildRelativeTimeSection(),
      filter: [],
      group,
    },
    displayOptions: {
      chartType: "line",
      analysis: "linear",
    },
  };
};

export const buildFunnelsBookmarkParams = (
  plan: IFunnelsReportPlan,
): Record<string, unknown> => {
  const behaviors = plan.steps.map((event) => ({
    type: "event",
    id: null,
    name: event,
    filters: [],
    filtersDeterminer: "all",
    funnelOrder: "loose",
  }));

  return {
    sections: {
      show: [
        {
          type: "metric",
          behavior: {
            type: "funnel",
            resourceType: "events",
            behaviors,
            conversionWindowDuration: 14,
            conversionWindowUnit: "day",
            funnelOrder: "loose",
            exclusions: [],
            aggregateBy: [],
            filter: [],
          },
          measurement: {
            math: "conversion_rate_unique",
            property: null,
            stepIndex: null,
          },
        },
      ],
      time: buildRelativeTimeSection(),
      filter: [],
      group: [],
      formula: [],
    },
    displayOptions: {
      chartType: "funnel-steps",
    },
  };
};

export const buildBookmarkParams = (plan: IReportPlan): Record<string, unknown> => {
  if (plan.type === "insights") {
    return buildInsightsBookmarkParams(plan);
  }

  return buildFunnelsBookmarkParams(plan);
};
