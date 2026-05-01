import { SkeletonGrid, SkeletonHeader, SkeletonList, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  // We don't know the view (week/month/list) from the loading boundary. Show the grid
  // (worst-case visual fill) so the layout doesn't shift dramatically when content lands.
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <div className="h-10 w-full animate-pulse rounded-md bg-surface-muted" />
      <SkeletonGrid />
      <SkeletonList rows={3} />
    </SkeletonPage>
  );
}
