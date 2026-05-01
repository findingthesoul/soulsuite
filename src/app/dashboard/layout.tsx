import * as React from "react";
import { Tour } from "@/components/tour/tour";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Tour autoOpen />
    </>
  );
}
