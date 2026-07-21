import type { ComponentType, SVGProps } from "react";
import type { DashboardNavIconName } from "../lib/dashboard-navigation";
import {
  HomeIcon,
  ListIcon,
  ClockIcon,
  CalendarIcon,
  DatabaseIcon,
  TrendingUpIcon,
  UploadIcon,
  ClipboardCheckIcon,
  CodeIcon,
  ImageIcon,
  SparklesIcon,
  SettingsIcon,
  BrainIcon,
  PuzzleIcon,
  ShieldIcon,
  DocumentIcon,
  PackageIcon,
  BarChartIcon,
  SearchIcon,
  UsersIcon,
  GaugeIcon,
  FlagIcon,
  BellIcon,
} from "./icons";

type DashboardIconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { title?: string }
>;

const ICON_COMPONENTS = {
  HomeIcon,
  ListIcon,
  ClockIcon,
  CalendarIcon,
  DatabaseIcon,
  TrendingUpIcon,
  UploadIcon,
  ClipboardCheckIcon,
  CodeIcon,
  ImageIcon,
  SparklesIcon,
  SettingsIcon,
  BrainIcon,
  PuzzleIcon,
  ShieldIcon,
  DocumentIcon,
  PackageIcon,
  BarChartIcon,
  SearchIcon,
  UsersIcon,
  GaugeIcon,
  FlagIcon,
  BellIcon,
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
