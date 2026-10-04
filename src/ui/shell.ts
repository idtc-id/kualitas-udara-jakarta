import { INDICATOR_LABELS } from "../core/ispu";
import type { AppContext, IconName, WidgetModule } from "../core/modules";
import type { Indicator, TimeMode } from "../core/types";
import { h } from "./dom";

const MODES: { id: TimeMode; label: string; icon: IconName }[] = [
  { id: "historical", label: "Historis", icon: "date-time" },
  { id: "realtime", label: "Real-time", icon: "clock" },
  { id: "forecast", label: "Forecast", icon: "clock-forward" },
];

/** Header controls: time mode, indicator, theme. */
export function mountHeader(ctx: AppContext, host: HTMLElement): void {
  const { store } = ctx;

  const modes = h("calcite-segmented-control", { scale: "s", attrs: { "aria-label": "Mode waktu" } });
  for (const m of MODES) {
    modes.append(h("calcite-segmented-control-item", { value: m.id, iconStart: m.icon, checked: store.state.mode === m.id }, m.label));
  }
  modes.addEventListener("calciteSegmentedControlChange", () => {
    store.set({ mode: modes.value as TimeMode, followLive: modes.value === "realtime" });
  });

  const indicator = h("calcite-select", { scale: "s", label: "Indikator", class: "header__indicator" });
  for (const [id, label] of Object.entries(INDICATOR_LABELS)) {
    indicator.append(h("calcite-option", { value: id, selected: id === store.state.indicator }, label));
  }
  indicator.addEventListener("calciteSelectChange", () => store.set({ indicator: indicator.value as Indicator }));

  const theme = h("calcite-action", { text: "Ganti tema", icon: "moon", scale: "s" });
  theme.addEventListener("click", () => store.set({ theme: store.state.theme === "dark" ? "light" : "dark" }));
  store.on(["theme"], (s) => (theme.icon = s.theme === "dark" ? "brightness" : "moon"), true);

  host.append(h("div", { class: "header__controls" }, modes, indicator, theme));
}

/**
 * Builds the action bar + panels from the widget registry. Start widgets open
 * one at a time from the action bar; end widgets stack in the right panel.
 */
export function mountWidgets(ctx: AppContext, widgets: WidgetModule[], startPanel: HTMLElement, endPanel: HTMLElement): void {
  const actionBar = h("calcite-action-bar", { slot: "action-bar", expandDisabled: false });
  const group = h("calcite-action-group");
  actionBar.append(group);
  startPanel.append(actionBar);

  const startPanels = new Map<string, HTMLElementTagNameMap["calcite-panel"]>();
  const actions = new Map<string, HTMLElementTagNameMap["calcite-action"]>();
  let open: string | null = null;

  const setOpen = (id: string | null) => {
    open = id;
    for (const [wid, panel] of startPanels) panel.hidden = wid !== id;
    for (const [wid, action] of actions) action.active = wid === id;
    (startPanel as HTMLElementTagNameMap["calcite-shell-panel"]).collapsed = id == null;
  };

  for (const widget of widgets) {
    const content = widget.create(ctx);
    if (widget.placement === "end") {
      const panel = h("calcite-panel", { heading: widget.title, collapsible: true, class: "widget-panel" }, content);
      panel.setAttribute("data-widget", widget.id);
      endPanel.append(panel);
      continue;
    }
    const panel = h("calcite-panel", { heading: widget.title, closable: true, hidden: true, class: "widget-panel" }, content);
    panel.setAttribute("data-widget", widget.id);
    panel.addEventListener("calcitePanelClose", () => setOpen(null));
    startPanels.set(widget.id, panel);
    startPanel.append(panel);

    const action = h("calcite-action", { text: widget.title, icon: widget.icon });
    action.addEventListener("click", () => setOpen(open === widget.id ? null : widget.id));
    actions.set(widget.id, action);
    group.append(action);
  }

  setOpen(widgets.find((w) => w.placement === "start" && w.openByDefault)?.id ?? null);

  // Selecting a station opens the chart widget if it exists.
  ctx.store.on(["selectedStationId"], (s) => {
    if (s.selectedStationId && startPanels.has("chart")) setOpen("chart");
  });
}
