import type { ReactNode } from "react";
import { BuilderCollapseIcon } from "./builder-collapse-icon";

type BuilderCellPanelHeaderProps = {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  panelName?: string;
  leadingActions?: ReactNode;
  headingActions?: ReactNode;
};

export function BuilderCellPanelHeader({
  title,
  isCollapsed,
  onToggle,
  panelName,
  leadingActions,
  headingActions
}: BuilderCellPanelHeaderProps) {
  const label = panelName ?? title;

  const header = (
    <div aria-expanded={!isCollapsed} className="builder-cell-panel-header">
      <div className="builder-cell-panel-title">
        {leadingActions ? (
          <span className="builder-cell-panel-leading-actions">{leadingActions}</span>
        ) : null}
        <button className="builder-cell-panel-title-label" onClick={onToggle} type="button">
          <strong>{title}</strong>
        </button>
      </div>
      <div className="builder-section-actions">
        <button
          aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
          className="builder-icon-button"
          onClick={onToggle}
          type="button"
        >
          <BuilderCollapseIcon expanded={!isCollapsed} />
        </button>
      </div>
    </div>
  );

  if (!headingActions) {
    return header;
  }

  return (
    <div className="builder-panel-toggle-row">
      {header}
      <span className="builder-panel-heading-actions">{headingActions}</span>
    </div>
  );
}
