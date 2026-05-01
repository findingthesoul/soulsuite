import { SkeletonHeader, SkeletonList, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <SkeletonList rows={4} />
    </SkeletonPage>
  );
}
