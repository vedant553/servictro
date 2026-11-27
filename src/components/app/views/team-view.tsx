"use client";

/**
 * Team management: members with roles (RBAC), skills for assignment
 * matching, invitations with resend/revoke. Role changes take effect on the
 * member's next token refresh; the API enforces permissions immediately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, patch as apiPatch, del as apiDel, ApiError } from "@/lib/api/client";
import type { TeamMember, TeamInvitation } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, SectionCard, EmptyState, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput, EnumSelect, TagList } from "@/components/app/shared/form-fields";
import { ROLE_STYLE, roleOptions } from "@/design-system/tokens";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { useCan } from "@/lib/auth/store";
import { fmtDate, fmtRelative } from "@/lib/format";
import type { ColumnDef } from "@tanstack/react-table";
import { Users, UserPlus, Send, Trash2, Wrench } from "lucide-react";
import { ROLES, type Role } from "@serviceos/contracts";

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("technician");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => apiPost("/api/v1/team/invitations", { email, role, title: title || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      toast({
        title: "Invitation created",
        description: "Share the invitation token with the teammate — email delivery is not configured in this environment (ADR-011).",
      });
      setEmail(""); setTitle("");
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Invitation failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite teammate</DialogTitle>
          <DialogDescription>The invitation carries an accept token; the invited user signs up with the same email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Work email" htmlFor="inv-email" required error={email && !/^\S+@\S+\.\S+$/.test(email) ? "Enter a valid email" : undefined}>
            <TextInput id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
          </Field>
          <Field label="Role" htmlFor="inv-role" required hint="Permissions are catalogued in ROLE_PERMISSIONS">
            <EnumSelect id="inv-role" options={roleOptions.filter((r) => r.value !== "owner")} value={role} onValueChange={(v) => setRole(v as Role)} />
          </Field>
          <Field label="Title (optional)" htmlFor="inv-title">
            <TextInput id="inv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior service engineer" />
          </Field>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); invite.mutate(); }} disabled={invite.isPending || !email}>
              <UserPlus className="mr-1.5 size-4" aria-hidden /> {invite.isPending ? "Inviting…" : "Create invitation"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillsEditor({ member }: { member: TeamMember }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [skills, setSkills] = useState(member.skills.join(", "));
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () => apiPatch(`/api/v1/team/members/${member.userId}`, { skills }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      toast({ title: "Skills updated" });
      setEditing(false);
    },
    onError: (err) => toast({ title: "Update failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <TagList items={member.skills} />
        <Button size="sm" variant="ghost" className="size-6 shrink-0 p-0 text-muted-foreground" onClick={() => setEditing(true)} aria-label="Edit skills">
          <Wrench className="size-3" aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <TextInput id={`skills-${member.userId}`} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="HT switchgear, VCB, relays" />
      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "…" : "Save"}</Button>
    </div>
  );
}

export function TeamView() {
  const canManage = useCan()("team:manage");
  const [inviteOpen, setInviteOpen] = useState(false);

  const members = useQuery({ queryKey: ["team", "members"], queryFn: () => apiGet<TeamMember[]>("/api/v1/team/members") });
  const invitations = useQuery({ queryKey: ["team", "invitations"], queryFn: () => apiGet<TeamInvitation[]>("/api/v1/team/invitations"), enabled: canManage });

  const updateMember = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: Record<string, unknown> }) => apiPatch(`/api/v1/team/members/${userId}`, body),
    onSuccess: () => {
      members.refetch();
    },
    onError: (err) => console.error(err),
  });

  const columns: ColumnDef<TeamMember, unknown>[] = [
    {
      accessorKey: "user.displayName",
      header: "Member",
      cell: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{i.row.original.user.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{i.row.original.user.email}</p>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: (i) =>
        canManage && i.row.original.role !== "owner" ? (
          <div className="w-40">
            <EnumSelect
              id={`role-${i.row.original.userId}`}
              options={roleOptions}
              value={i.row.original.role}
              onValueChange={(v) =>
                updateMember.mutate({ userId: i.row.original.userId, body: { role: v } })
              }
            />
          </div>
        ) : (
          <StatusBadge style={ROLE_STYLE[i.getValue<Role>()]} />
        ),
    },
    { accessorKey: "title", header: "Title", cell: (i) => i.getValue<string>() ?? <span className="text-muted-foreground">—</span> },
    {
      accessorKey: "skills",
      header: "Skills",
      cell: (i) => <SkillsEditor member={i.row.original} />,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: (i) => (
        <div className="flex items-center gap-2">
          <TextBadge tone={i.getValue<string>() === "active" ? "success" : "warning"}>{i.getValue<string>()}</TextBadge>
          {canManage && i.row.original.role !== "owner" ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() =>
                updateMember.mutate({
                  userId: i.row.original.userId,
                  body: { status: i.getValue<string>() === "active" ? "suspended" : "active" },
                })
              }
            >
              {i.getValue<string>() === "active" ? "Suspend" : "Reactivate"}
            </Button>
          ) : null}
        </div>
      ),
    },
    { accessorKey: "createdAt", header: "Joined", cell: (i) => <span className="text-muted-foreground">{fmtDate(i.getValue<string>())}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Roles follow the RBAC catalog; technicians' skills drive assignment matching."
        actions={canManage && <Button onClick={() => setInviteOpen(true)}><UserPlus className="mr-1.5 size-4" aria-hidden />Invite member</Button>}
      />

      <DataTable
        columns={columns}
        data={members.data ?? []}
        loading={members.isLoading}
        emptyTitle="No members"
        rowNoun="members"
        ariaLabel="Team members"
      />

      {canManage ? (
        <SectionCard title={`Pending invitations (${invitations.data?.length ?? 0})`} description="Tokens are one-time; email delivery is a production integration (ADR-011).">
          {!invitations.data?.length ? (
            <EmptyState title="No open invitations" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {invitations.data.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      <StatusBadge style={ROLE_STYLE[inv.role]} /> · expires {fmtRelative(inv.expiresAt)}
                      {inv.title ? ` · ${inv.title}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <TextBadge tone={inv.status === "pending" ? "warning" : inv.status === "accepted" ? "success" : "neutral"}>{inv.status}</TextBadge>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Copy invitation token"
                      onClick={() => {
                        void navigator.clipboard?.writeText(inv.id);
                      }}
                    >
                      <Send className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[color:var(--status-danger)]"
                      aria-label="Revoke invitation"
                      onClick={() =>
                        apiDel(`/api/v1/team/invitations/${inv.id}`)
                          .then(() => invitations.refetch())
                          .catch(() => undefined)
                      }
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      {canManage ? <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} /> : null}
    </div>
  );
}
