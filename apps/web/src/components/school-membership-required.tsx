import { EmptyState, Page } from "@/components/ui";

export function SchoolMembershipRequired() {
  return (
    <Page title="Your adventures" lede="Join your school to create and play classroom adventures.">
      <EmptyState title="Your account isn&apos;t part of a school yet.">
        Staff need to ask their school admin to add them. Students should open their school&apos;s sign-up link to join.
      </EmptyState>
    </Page>
  );
}
