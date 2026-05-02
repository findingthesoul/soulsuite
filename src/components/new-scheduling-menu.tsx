"use client";

import { useRouter } from "next/navigation";
import { Plus, User, Users, Repeat, Group as GroupIcon, CalendarClock, Vote } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";

interface ItemSpec {
  key: string;
  title: string;
  hosts: string;
  invitees: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  enabledIn: ("personal" | "team")[];
  disabledHint?: string;
}

const PRIMARY_ITEMS: ItemSpec[] = [
  {
    key: "one-on-one",
    title: "One-on-one",
    hosts: "1 host",
    invitees: "1 invitee",
    blurb: "Coffee chats, intro calls, 1:1 reviews.",
    icon: User,
    href: "__one_on_one__",
    enabledIn: ["personal", "team"],
  },
  {
    key: "group",
    title: "Group",
    hosts: "1 host",
    invitees: "Multiple invitees",
    blurb: "Webinars, office hours, classes.",
    icon: GroupIcon,
    href: "__group__",
    enabledIn: ["personal", "team"],
  },
  {
    key: "round-robin",
    title: "Round robin",
    hosts: "Rotating hosts",
    invitees: "1 invitee",
    blurb: "Distribute bookings across a team.",
    icon: Repeat,
    href: "__team_routing__:ROUND_ROBIN",
    enabledIn: ["team"],
    disabledHint: "Lives inside a Team — pick or create one.",
  },
  {
    key: "collective",
    title: "Collective",
    hosts: "Multiple hosts",
    invitees: "1 invitee",
    blurb: "Panel interviews, group sales calls.",
    icon: Users,
    href: "__team_routing__:COLLECTIVE",
    enabledIn: ["team"],
    disabledHint: "Lives inside a Team — pick or create one.",
  },
];

const SECONDARY_ITEMS: ItemSpec[] = [
  {
    key: "one-off",
    title: "One-off meeting",
    hosts: "",
    invitees: "",
    blurb: "Offer a single time outside your normal schedule.",
    icon: CalendarClock,
    href: "/dashboard/meeting-types/one-off/new",
    enabledIn: ["personal"],
    disabledHint: "One-offs are personal-only for now.",
  },
  {
    key: "poll",
    title: "Meeting poll",
    hosts: "",
    invitees: "",
    blurb: "Let invitees vote on a time to meet.",
    icon: Vote,
    href: "/dashboard/polls/new",
    enabledIn: ["personal", "team"],
  },
];

interface Props {
  context: "personal" | "team";
  projectSlug?: string; // when context === "team"
}

export function NewSchedulingMenu({ context, projectSlug }: Props) {
  const router = useRouter();

  function resolveHref(href: string): string {
    if (href === "__one_on_one__") {
      return context === "team" && projectSlug
        ? `/dashboard/projects/${projectSlug}/meeting-types/new?routing=SINGLE`
        : "/dashboard/meeting-types/new";
    }
    if (href === "__group__") {
      return context === "team" && projectSlug
        ? `/dashboard/projects/${projectSlug}/meeting-types/new?routing=SINGLE&kind=group`
        : "/dashboard/meeting-types/new?kind=group";
    }
    if (href.startsWith("__team_routing__:") && context === "team" && projectSlug) {
      const mode = href.split(":")[1];
      return `/dashboard/projects/${projectSlug}/meeting-types/new?routing=${mode}`;
    }
    if (href.startsWith("__team_routing__:")) {
      return "/dashboard/projects";
    }
    if (href === "/dashboard/polls/new" && context === "team" && projectSlug) {
      return `/dashboard/polls/new?team=${projectSlug}`;
    }
    return href;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants()} data-tour="new-button">
        <Plus className="h-4 w-4" />
        New
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuLabel className="px-2">Event type</DropdownMenuLabel>
        {PRIMARY_ITEMS.map((item) => (
          <PickerItem
            key={item.key}
            item={item}
            disabled={!item.enabledIn.includes(context)}
            onPick={() => router.push(resolveHref(item.href))}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-2">More ways to meet</DropdownMenuLabel>
        {SECONDARY_ITEMS.map((item) => (
          <PickerItem
            key={item.key}
            item={item}
            disabled={!item.enabledIn.includes(context)}
            onPick={() => router.push(resolveHref(item.href))}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickerItem({
  item,
  disabled,
  onPick,
}: {
  item: ItemSpec;
  disabled: boolean;
  onPick: () => void;
}) {
  const Icon = item.icon;
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onPick();
      }}
      className={`flex items-start gap-3 px-2 py-2.5 ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        {(item.hosts || item.invitees) && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.hosts}
            {item.invitees && (
              <>
                {" "}
                <span className="text-subtle-foreground">→</span> {item.invitees}
              </>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {disabled && item.disabledHint ? item.disabledHint : item.blurb}
        </p>
      </div>
    </DropdownMenuItem>
  );
}
