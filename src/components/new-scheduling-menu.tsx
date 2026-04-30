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
  href?: string;            // enabled if set
  comingSoon?: boolean;
}

const ITEMS: ItemSpec[] = [
  {
    key: "one-on-one",
    title: "One-on-one",
    hosts: "1 host",
    invitees: "1 invitee",
    blurb: "Coffee chats, intro calls, 1:1 reviews.",
    icon: User,
    href: "/dashboard/meeting-types/new",
  },
  {
    key: "group",
    title: "Group",
    hosts: "1 host",
    invitees: "Multiple invitees",
    blurb: "Webinars, office hours, classes.",
    icon: GroupIcon,
    comingSoon: true,
  },
  {
    key: "round-robin",
    title: "Round robin",
    hosts: "Rotating hosts",
    invitees: "1 invitee",
    blurb: "Distribute bookings across a team. Lives inside a Team — pick or create one next.",
    icon: Repeat,
    href: "/dashboard/projects",
  },
  {
    key: "collective",
    title: "Collective",
    hosts: "Multiple hosts",
    invitees: "1 invitee",
    blurb: "Panel interviews, group sales calls.",
    icon: Users,
    comingSoon: true,
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
    comingSoon: true,
  },
  {
    key: "poll",
    title: "Meeting poll",
    hosts: "",
    invitees: "",
    blurb: "Let invitees vote on a time to meet.",
    icon: Vote,
    href: "/dashboard/polls/new",
  },
];

export function NewSchedulingMenu() {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants()}>
        <Plus className="h-4 w-4" />
        New
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuLabel className="px-2">Event type</DropdownMenuLabel>
        {ITEMS.map((item) => (
          <PickerItem key={item.key} item={item} onPick={(href) => router.push(href)} />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-2">More ways to meet</DropdownMenuLabel>
        {SECONDARY_ITEMS.map((item) => (
          <PickerItem key={item.key} item={item} onPick={(href) => router.push(href)} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickerItem({ item, onPick }: { item: ItemSpec; onPick: (href: string) => void }) {
  const Icon = item.icon;
  const disabled = !item.href || item.comingSoon;

  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onPick(item.href!);
      }}
      className="flex items-start gap-3 px-2 py-2.5 cursor-pointer"
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{item.title}</p>
          {item.comingSoon && (
            <span className="text-[10px] uppercase tracking-wide text-subtle-foreground border border-border rounded px-1 py-0.5">
              Soon
            </span>
          )}
        </div>
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
        <p className="text-xs text-muted-foreground mt-0.5">{item.blurb}</p>
      </div>
    </DropdownMenuItem>
  );
}
