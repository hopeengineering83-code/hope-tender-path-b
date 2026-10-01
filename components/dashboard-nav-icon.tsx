import type { ComponentType, SVGProps } from "react";
import type { DashboardNavIconName } from "../lib/dashboard-navigation";
import {
  ListIcon,
  DatabaseIcon,
  BrainIcon,
  DocumentIcon,
  GaugeIcon,
} from "./icons";

type DashboardIconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { title?: string }
>;

/**
 * One component per sidebar destination. `satisfies Record<...>` makes this
 * exhaustive against DashboardNavIconName, so an icon can never be added here
 * without a destination, or referenced by a destination without existing here.
 */
const ICON_COMPONENTS = {
  ListIcon,
  DatabaseIcon,
  BrainIcon,
  DocumentIcon,
  GaugeIcon,
} satisfies Record<DashboardNavIconName, DashboardIconComponent>;

export function DashboardNavIcon({
  iconName,
  className,
}: {
  iconName: DashboardNavIconName;
  className?: string;
}) {
  const Icon = ICON_COMPONENTS[iconName];
  return <Icon className={className} />;
}
