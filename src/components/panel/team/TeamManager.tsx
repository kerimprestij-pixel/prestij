"use client";
// /panel/ekip: staff list with create, role change, deactivate/reactivate and password reset. Each action
// posts to its admin-only Server Action; the page re-renders with fresh data after every success.
import { useId, useState, useTransition } from "react";
import { KeyRound, ShieldCheck, UserCheck, UserPlus, UserRoundCog, UserX } from "lucide-react";
import {
  changeStaffRoleAction,
  createStaffAction,
  resetStaffPasswordAction,
  setStaffActiveAction,
} from "@/app/panel/(dashboard)/ekip/actions";
import Card from "@/components/panel/Card";
import EmptyState from "@/components/panel/EmptyState";
import { Field, TextInput } from "@/components/panel/form";
import { formatDateTime, formatNumber, initials } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import { Badge, Button, ConfirmDialog, Dialog, toast } from "@/components/panel/ui";
import type { Tone } from "@/components/panel/labels";
import { toPayloadFormData, type ActionResult } from "@/lib/panel/action-types";
import { TEAM_PAGE_DESCRIPTION, TEAM_ROLE_INFO, TEAM_ROLES, type StaffRole } from "@/lib/panel/team/rules";
import type { StaffMember } from "@/lib/panel/team/service";
import { cn } from "@/lib/utils";
import PasswordReveal, { type RevealedPassword } from "./PasswordReveal";
import RoleChoice from "./RoleChoice";

export const ROLE_TONE: Record<StaffRole, Tone> = { admin: "gold", editor: "info", staff: "neutral" };

type Confirm = { kind: "deactivate" | "reactivate" | "reset"; member: StaffMember } | null;

function reportFailure<T>(result: ActionResult<T>) {
  if (result.ok) return;
  if (result.code === "conflict") {
    toast.error(result.error, { duration: 0, action: { label: "Sayfayı yenile", onClick: () => window.location.reload() } });
  } else {
    toast.error(result.error);
  }
}

export default function TeamManager({ members, currentUserId }: { members: StaffMember[]; currentUserId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [roleFor, setRoleFor] = useState<StaffMember | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [revealed, setRevealed] = useState<RevealedPassword | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = TEAM_ROLES.map((role) => ({ role, n: members.filter((m) => m.role === role && m.active).length }));
  const inactive = members.filter((m) => !m.active).length;

  function runConfirm() {
    if (!confirm) return;
    const { kind, member } = confirm;
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          if (kind === "reset") {
            const result = await resetStaffPasswordAction(null, toPayloadFormData({ userId: member.id }));
            if (result.ok && result.data) {
              setConfirm(null);
              setRevealed({ kind: "reset", name: result.data.member.name, email: result.data.member.email, password: result.data.password, self: member.id === currentUserId });
            } else reportFailure(result);
          } else {
            const result = await setStaffActiveAction(
              null,
              toPayloadFormData({ userId: member.id, active: kind === "reactivate", updatedAt: member.updatedAt }),
            );
            if (result.ok) {
              setConfirm(null);
              toast.success(result.message ?? "Kaydedildi.");
            } else reportFailure(result);
          }
        } finally {
          resolve();
        }
      });
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Sistem"
        title="Ekip"
        description={TEAM_PAGE_DESCRIPTION}
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setCreateOpen(true)}>
            Yeni kullanıcı
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Card
            title={`${formatNumber(members.length)} kişi`}
            description={
              [
                ...counts.filter((c) => c.n > 0).map((c) => `${formatNumber(c.n)} ${TEAM_ROLE_INFO[c.role].label.toLocaleLowerCase("tr-TR")}`),
                inactive > 0 ? `${formatNumber(inactive)} devre dışı` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Henüz ekip üyesi yok"
            }
            flush
          >
            {members.length === 0 ? (
              <EmptyState
                icon={UserPlus}
                title="Henüz ekip üyesi yok"
                description="Siparişleri hazırlayan veya içerik düzenleyen çalışma arkadaşlarınızı ekleyin."
                action={
                  <Button variant="primary" icon={UserPlus} onClick={() => setCreateOpen(true)}>
                    Yeni kullanıcı
                  </Button>
                }
              />
            ) : (
              <ul className="@container divide-y divide-border" aria-label="Ekip üyeleri">
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    self={member.id === currentUserId}
                    disabled={pending}
                    onRole={() => setRoleFor(member)}
                    onReset={() => setConfirm({ kind: "reset", member })}
                    onToggle={() => setConfirm({ kind: member.active ? "deactivate" : "reactivate", member })}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>
        <RoleLegend />
      </div>

      <CreateMemberDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(value) => {
          setCreateOpen(false);
          setRevealed(value);
        }}
      />
      <RoleDialog member={roleFor} onClose={() => setRoleFor(null)} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => {
          if (!pending) setConfirm(null);
        }}
        onConfirm={runConfirm}
        pending={pending}
        tone={confirm?.kind === "deactivate" ? "danger" : "default"}
        title={
          confirm?.kind === "deactivate"
            ? `${confirm.member.name} devre dışı bırakılsın mı?`
            : confirm?.kind === "reactivate"
              ? `${confirm.member.name} yeniden etkinleştirilsin mi?`
              : confirm?.member.id === currentUserId
                ? "Şifreniz yenilensin mi?"
                : `${confirm?.member.name ?? ""} için yeni şifre oluşturulsun mu?`
        }
        description={
          confirm?.kind === "deactivate"
            ? "Hesap panele giriş yapamaz ve açık oturumları hemen kapanır. İstediğiniz zaman yeniden etkinleştirebilirsiniz."
            : confirm?.kind === "reactivate"
              ? "Kullanıcı mevcut şifresiyle yeniden giriş yapabilir. Şifreyi de değiştirmek isterseniz ardından “Şifreyi sıfırla”yı kullanın."
              : confirm?.member.id === currentUserId
                ? "Eski şifreniz hemen geçersiz olur ve diğer cihazlardaki oturumlarınız kapanır; bu oturum açık kalır. Yeni şifre yalnızca bir kez gösterilir."
                : "Eski şifre hemen geçersiz olur ve kullanıcının tüm oturumları kapanır. Yeni şifre yalnızca bir kez gösterilir."
        }
        confirmLabel={
          confirm?.kind === "deactivate" ? "Devre dışı bırak" : confirm?.kind === "reactivate" ? "Etkinleştir" : "Yeni şifre oluştur"
        }
      />
      <PasswordReveal value={revealed} onClose={() => setRevealed(null)} />
    </>
  );
}

function MemberRow({
  member,
  self,
  disabled,
  onRole,
  onReset,
  onToggle,
}: {
  member: StaffMember;
  self: boolean;
  disabled: boolean;
  onRole: () => void;
  onReset: () => void;
  onToggle: () => void;
}) {
  const noteId = useId();
  return (
    <li className={cn("flex flex-col gap-3 px-4 py-4 sm:px-5 @2xl:flex-row @2xl:items-center @2xl:gap-4", !member.active && "bg-surface-2/40")}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full border text-sm font-medium",
            member.active ? "border-gold/40 bg-gold/10 text-text" : "border-border bg-surface-2 text-text-muted",
          )}
        >
          {initials(member.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("truncate text-sm font-medium", member.active ? "text-text" : "text-text-muted")}>{member.name}</span>
            {self ? (
              <Badge size="sm" variant="soft" tone="gold">
                Siz
              </Badge>
            ) : null}
          </p>
          <p className="truncate text-xs text-text-muted">{member.email}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={ROLE_TONE[member.role]}>{TEAM_ROLE_INFO[member.role].label}</Badge>
            {member.active ? (
              <Badge tone="success" variant="soft" size="sm">
                Etkin
              </Badge>
            ) : (
              <Badge tone="danger" variant="soft" size="sm">
                Devre dışı
              </Badge>
            )}
            <span className="text-xs text-text-muted">
              {member.lastSignInAt ? (
                <>
                  Son giriş <time dateTime={member.lastSignInAt}>{formatDateTime(member.lastSignInAt)}</time>
                </>
              ) : member.active ? (
                "Açık oturumu yok"
              ) : null}
            </span>
          </p>
          {self ? (
            <p id={noteId} className="mt-1.5 text-xs text-text-muted">
              Kendi rolünüzü ve erişiminizi değiştiremezsiniz; bunun için başka bir yönetici gerekir.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 ps-13 @2xl:justify-end @2xl:ps-0" role="group" aria-label={`${member.name} için işlemler`}>
        {self ? (
          <Button size="sm" icon={KeyRound} onClick={onReset} disabled={disabled} aria-describedby={noteId}>
            Şifremi yenile
          </Button>
        ) : (
          <>
            <Button size="sm" icon={UserRoundCog} onClick={onRole} disabled={disabled}>
              Rol
            </Button>
            <Button size="sm" icon={KeyRound} onClick={onReset} disabled={disabled}>
              Şifreyi sıfırla
            </Button>
            {member.active ? (
              <Button size="sm" variant="danger-outline" icon={UserX} onClick={onToggle} disabled={disabled}>
                Devre dışı bırak
              </Button>
            ) : (
              <Button size="sm" icon={UserCheck} onClick={onToggle} disabled={disabled}>
                Etkinleştir
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function RoleLegend() {
  return (
    <Card title="Roller ne yapabilir?" description="Erişim her işlemde sunucuda yeniden denetlenir.">
      <dl className="space-y-4">
        {[...TEAM_ROLES].reverse().map((role) => (
          <div key={role}>
            <dt>
              <Badge tone={ROLE_TONE[role]}>{TEAM_ROLE_INFO[role].label}</Badge>
            </dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-text-muted">{TEAM_ROLE_INFO[role].summary}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-gold-text" />
        Şifreler yalnızca oluşturulduğu anda bir kez gösterilir; hiçbir yerde saklanmaz. Her zaman en az bir etkin yönetici kalır.
      </p>
    </Card>
  );
}

type CreateErrors = Partial<Record<"name" | "email" | "role", string>>;

function CreateMemberDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (value: RevealedPassword) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [errors, setErrors] = useState<CreateErrors>({});
  const [pending, startTransition] = useTransition();
  const formId = useId();

  function close() {
    if (pending) return;
    onClose();
    setName("");
    setEmail("");
    setRole("staff");
    setErrors({});
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createStaffAction(null, toPayloadFormData({ name, email, role }));
      if (result.ok && result.data) {
        toast.success(result.message ?? "Kullanıcı oluşturuldu.");
        onCreated({ kind: "created", name: result.data.member.name, email: result.data.member.email, password: result.data.password, self: false });
        setName("");
        setEmail("");
        setRole("staff");
        setErrors({});
        return;
      }
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as CreateErrors);
        reportFailure(result);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!pending}
      title="Yeni ekip üyesi"
      description="Hesap hemen açılır. Güçlü bir şifre oluşturulur ve yalnızca bir kez gösterilir."
      size="md"
      footer={
        <>
          <Button onClick={close} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} variant="primary" icon={UserPlus} pending={pending} pendingLabel="Oluşturuluyor…">
            Kullanıcıyı oluştur
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-5">
        <Field label="Ad soyad" required error={errors.name} name="name">
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              setErrors((e) => ({ ...e, name: undefined }));
            }}
            maxLength={80}
            autoComplete="off"
            autoFocus
          />
        </Field>
        <Field label="E-posta" required error={errors.email} name="email" help="Kullanıcı panele bu adresle giriş yapar.">
          <TextInput
            type="email"
            inputMode="email"
            value={email}
            onChange={(v) => {
              setEmail(v);
              setErrors((e) => ({ ...e, email: undefined }));
            }}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <RoleChoice value={role} onChange={setRole} error={errors.role} />
      </form>
    </Dialog>
  );
}

function RoleDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  return member ? <RoleDialogBody key={member.id} member={member} onClose={onClose} /> : null;
}

function RoleDialogBody({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const [role, setRole] = useState<StaffRole>(member.role);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const formId = useId();
  const demotingAdmin = member.role === "admin" && role !== "admin";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (role === member.role) {
      onClose();
      return;
    }
    startTransition(async () => {
      const result = await changeStaffRoleAction(null, toPayloadFormData({ userId: member.id, role, updatedAt: member.updatedAt }));
      if (result.ok) {
        toast.success(result.message ?? "Rol güncellendi.");
        onClose();
      } else {
        setError(result.fieldErrors?.role);
        reportFailure(result);
      }
    });
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      dismissible={!pending}
      title="Rolü değiştir"
      description={`${member.name} · ${member.email}`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} variant="primary" pending={pending} pendingLabel="Kaydediliyor…" disabled={role === member.role}>
            Rolü kaydet
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <RoleChoice value={role} onChange={setRole} error={error} current={member.role} />
        {demotingAdmin ? (
          <p className="rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-sm text-text">
            Yönetici yetkisi kaldırılınca bu kişi ayarlara, ekibe ve işlem kaydına erişemez.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
