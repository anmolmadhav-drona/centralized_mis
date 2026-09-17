'use client'

// Settings — MIS Fields manager (dynamic columns) + User management (ADMIN)
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Columns3, Plus, Pencil, Trash2, Users, Loader2, Lock, GripVertical,
  Database, Shield, UserCog, X, Check,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/lib/client/store'
import { useFields } from '@/lib/client/hooks'
import { apiGet, apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/client/api'
import { can, ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/lib/rbac'
import type { Role } from '@/lib/types'
import { fmtDateTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import type { FieldDef } from '@/lib/types'

const DATA_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'TEXT', label: 'Text', hint: 'single-line values like names or numbers-as-text' },
  { value: 'LONG_TEXT', label: 'Long Text', hint: 'multi-line notes and remarks' },
  { value: 'INTEGER', label: 'Integer', hint: 'whole numbers' },
  { value: 'DECIMAL', label: 'Decimal', hint: 'numbers with fraction (charges, rates)' },
  { value: 'DATE', label: 'Date', hint: 'calendar dates' },
  { value: 'DATETIME', label: 'Date & Time', hint: 'timestamps' },
  { value: 'BOOLEAN', label: 'Yes / No', hint: 'checkbox-style flag' },
  { value: 'DROPDOWN', label: 'Dropdown', hint: 'choose from a fixed list' },
]

type SettingsTab = 'fields' | 'users'

export default function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>('fields')
  const user = useAppStore((s) => s.user)
  const isFieldAdmin = user ? can(user.role, 'fields:manage' as never) : false
  const isUserAdmin = user ? can(user.role, 'users:manage' as never) : false

  const visibleTab = tab === 'users' && !isUserAdmin ? 'fields' : tab

  return (
    <div className="space-y-4 p-4 lg:p-5">
      <Tabs value={visibleTab} onValueChange={(v) => setTab(v as SettingsTab)}>
        <TabsList className="h-9">
          <TabsTrigger value="fields" className="gap-1.5 text-[13px]">
            <Columns3 className="h-3.5 w-3.5" /> MIS Fields
          </TabsTrigger>
          {isUserAdmin && (
            <TabsTrigger value="users" className="gap-1.5 text-[13px]">
              <Users className="h-3.5 w-3.5" /> Users & Roles
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="fields">
          <FieldsManager isAdmin={isFieldAdmin} />
        </TabsContent>
        <TabsContent value="users">
          <UsersManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ==================================================================
// MIS FIELDS MANAGER
// ==================================================================
function FieldsManager({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, refetch } = useFields()
  const qc = useQueryClient()
  const fields = data?.fields || []
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FieldDef | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FieldDef | null>(null)

  const coreFields = fields.filter((f) => f.isCore)
  const customFields = fields.filter((f) => !f.isCore)

  const onSaved = () => {
    refetch()
    qc.invalidateQueries({ queryKey: ['fields'] })
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-[15px]">MIS columns ({fields.length})</CardTitle>
          <CardDescription>
            The field registry drives the entire system — table, forms, filters, validation, Excel import/export and reports.
            Core columns come from the original workbook; custom columns can be added without a developer.
          </CardDescription>
        </div>
        {isAdmin && (
          <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true) }}>
            <Plus className="h-4 w-4" /> Add Column
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : (
          <div className="nice-scroll max-h-[calc(100vh-260px)] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Column</TableHead>
                  <TableHead>Excel header</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Options</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SectionRow label={`Core columns (${coreFields.length})`} icon={Database} />
                {coreFields.map((f) => (
                  <FieldRow key={f.id} field={f} isAdmin={isAdmin} onEdit={() => { setEditing(f); setDialogOpen(true) }} onDelete={null} />
                ))}
                {customFields.length > 0 && <SectionRow label={`Custom columns (${customFields.length})`} icon={Columns3} />}
                {customFields.map((f) => (
                  <FieldRow key={f.id} field={f} isAdmin={isAdmin} onEdit={() => { setEditing(f); setDialogOpen(true) }} onDelete={() => setDeleteTarget(f)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <FieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        field={editing}
        onSaved={onSaved}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete column “{deleteTarget?.displayName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the column and all stored values for it in every record.
              The action is audited. Consider deactivating instead if you may need the data later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault()
                if (!deleteTarget) return
                try {
                  await apiDelete(`/api/fields/${deleteTarget.id}`)
                  toast.success(`Column “${deleteTarget.displayName}” deleted`)
                  setDeleteTarget(null)
                  onSaved()
                } catch (err) {
                  toast.error('Delete failed', { description: err instanceof ApiClientError ? err.message : 'Please try again.' })
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete column
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function SectionRow({ label, icon: Icon }: { label: string; icon: typeof Database }) {
  return (
    <TableRow className="bg-muted/50 hover:bg-muted/50">
      <TableCell colSpan={8} className="py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
      </TableCell>
    </TableRow>
  )
}

function FieldRow({ field, isAdmin, onEdit, onDelete }: {
  field: FieldDef
  isAdmin: boolean
  onEdit: () => void
  onDelete: (() => void) | null
}) {
  return (
    <TableRow className={cn(!field.active && 'opacity-50')}>
      <TableCell className="text-muted-foreground/40"><GripVertical className="h-3.5 w-3.5" /></TableCell>
      <TableCell className="font-medium">
        {field.displayName}
        {field.isSystem && <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[10px] text-muted-foreground">auto</Badge>}
        {!field.active && <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[10px] text-muted-foreground">inactive</Badge>}
      </TableCell>
      <TableCell className="font-mono text-[11.5px] text-muted-foreground">{field.fieldName}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="font-normal">{field.dataType.toLowerCase()}</Badge>
      </TableCell>
      <TableCell>{field.required ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <span className="text-muted-foreground/40">—</span>}</TableCell>
      <TableCell className="max-w-[220px] truncate text-[12px] text-muted-foreground" title={field.options?.join(', ')}>
        {field.options ? `${field.options.length} values` : '—'}
      </TableCell>
      <TableCell>
        <span className="text-[12px] text-muted-foreground">{field.isCore ? 'workbook' : 'custom'}</span>
      </TableCell>
      <TableCell className="text-right">
        {isAdmin && !field.isSystem && (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label={`Edit ${field.displayName}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {onDelete && !field.isCore && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={onDelete} aria-label={`Delete ${field.displayName}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}

// ------------------------------------------------------------------
// Add / Edit field dialog
// ------------------------------------------------------------------
function FieldDialog({ open, onOpenChange, field, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  field: FieldDef | null
  onSaved: () => void
}) {
  const isEdit = !!field
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [dataType, setDataType] = useState('TEXT')
  const [required, setRequired] = useState(false)
  const [optionsText, setOptionsText] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // reset on open
  useMemo(() => {
    if (open) {
      setName(field?.fieldName ?? '')
      setDisplayName(field?.displayName ?? '')
      setDataType(field?.dataType ?? 'TEXT')
      setRequired(field?.required ?? false)
      setOptionsText(field?.options?.join('\n') ?? '')
      setActive(field?.active ?? true)
      setError(null)
    }
  }, [open, field])

  const submit = async () => {
    setError(null)
    if (!isEdit && name.trim().length < 2) {
      setError('Enter a column name (at least 2 characters).')
      return
    }
    const options = optionsText.trim()
      ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
      : undefined
    if (dataType === 'DROPDOWN' && (!options || options.length === 0)) {
      setError('Dropdown columns need at least one option (one per line).')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await apiPatch(`/api/fields/${field!.id}`, {
          displayName: displayName.trim() || undefined,
          required,
          active,
          options: dataType === 'DROPDOWN' ? options : undefined,
        })
        toast.success('Column updated', { description: 'The change applies across the portal immediately.' })
      } else {
        await apiPost('/api/fields', {
          fieldName: name.trim(),
          displayName: displayName.trim() || undefined,
          dataType,
          required,
          options,
        })
        toast.success('Column added', {
          description: `“${displayName.trim() || name.trim()}” is now permanently part of the MIS — it appears in the table, forms, filters and Excel import/export.`,
        })
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit column — ${field?.displayName}` : 'Add MIS column'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Adjust the display name, requirement, dropdown options or active state.'
              : 'The new column becomes a permanent part of the MIS schema — no developer needed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Column name (Excel header)</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Vehicle Number"
                disabled={isEdit}
              />
              <p className="text-[11px] text-muted-foreground">This exact name becomes the Excel column header on import/export.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Display name (portal)</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={isEdit ? field?.displayName : 'e.g. Vehicle Number'}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data type</Label>
            <Select value={dataType} onValueChange={setDataType} disabled={isEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATA_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="font-medium">{t.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && <p className="text-[11px] text-muted-foreground">Data type is fixed after creation (data integrity).</p>}
          </div>
          {dataType === 'DROPDOWN' && (
            <div className="space-y-1.5">
              <Label>Dropdown options — one per line</Label>
              <Textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={'Option 1\nOption 2\nOption 3'}
                rows={5}
              />
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg border px-3.5 py-2.5">
            <div>
              <Label className="text-[13px]">Required</Label>
              <p className="text-[11px] text-muted-foreground">Records cannot be saved without this field.</p>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} />
          </div>
          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border px-3.5 py-2.5">
              <div>
                <Label className="text-[13px]">Active</Label>
                <p className="text-[11px] text-muted-foreground">Inactive columns are hidden but data is preserved.</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEdit ? 'Save changes' : 'Add column'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================================================================
// USERS MANAGER
// ==================================================================
interface UserRow {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
  createdAt: string
}

function UsersManager() {
  const qc = useQueryClient()
  const me = useAppStore((s) => s.user)
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<{ users: UserRow[] }>('/api/users'),
  })
  const [addOpen, setAddOpen] = useState(false)

  const users = data?.users || []

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-[15px]">Users & roles ({users.length})</CardTitle>
          <CardDescription>
            Role-based access control — ADMIN, MANAGER, USER and VIEWER. Structured so company SSO (Microsoft Entra ID) can be layered in later.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add User
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRowView key={u.id} user={u} isSelf={u.id === me?.id} onChanged={() => qc.invalidateQueries({ queryKey: ['users'] })} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onAdded={() => qc.invalidateQueries({ queryKey: ['users'] })} />
    </Card>
  )
}

function UserRowView({ user, isSelf, onChanged }: { user: UserRow; isSelf: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)

  const update = async (patch: Record<string, unknown>, desc: string) => {
    setBusy(true)
    try {
      await apiPatch(`/api/users/${user.id}`, patch)
      toast.success(desc)
      onChanged()
    } catch (err) {
      toast.error('Update failed', { description: err instanceof ApiClientError ? err.message : 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <TableRow className={cn(!user.active && 'opacity-60')}>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div>
            <p className="text-[13px] font-medium">
              {user.name}
              {isSelf && <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[10px] text-muted-foreground">you</Badge>}
            </p>
            <p className="text-[11.5px] text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Select value={user.role} onValueChange={(v) => update({ role: v }, `Role changed to ${v}`)} disabled={busy || isSelf}>
          <SelectTrigger className="h-8 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['ADMIN', 'MANAGER', 'USER', 'VIEWER'] as Role[]).map((r) => (
              <SelectItem key={r} value={r}>
                <span className="flex items-center gap-1.5">
                  {r === 'ADMIN' ? <Shield className="h-3 w-3" /> : r === 'MANAGER' ? <UserCog className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {ROLE_LABELS[r]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <span className={`badge-tone ${user.active ? 'badge-success' : 'badge-neutral'}`}>
          {user.active ? 'active' : 'disabled'}
        </span>
      </TableCell>
      <TableCell className="text-[12px] text-muted-foreground">{fmtDateTime(user.createdAt)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[11.5px]"
            disabled={busy || isSelf}
            onClick={() => update({ active: !user.active }, user.active ? 'User disabled' : 'User enabled')}
          >
            {user.active ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[11.5px]"
            disabled={busy}
            onClick={() => {
              const pw = window.prompt(`New password for ${user.name} (min 8 characters):`)
              if (pw && pw.length >= 8) void update({ password: pw }, 'Password reset')
              else if (pw) toast.error('Password too short', { description: 'Use at least 8 characters.' })
            }}
          >
            Reset password
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function AddUserDialog({ open, onOpenChange, onAdded }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('USER')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!name.trim() || !email.trim()) { setError('Name and email are required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setSaving(true)
    try {
      await apiPost('/api/users', { name: name.trim(), email: email.trim(), role, password })
      toast.success('User created', { description: `${name.trim()} can now sign in as ${ROLE_LABELS[role]}.` })
      onAdded()
      onOpenChange(false)
      setName(''); setEmail(''); setPassword(''); setRole('USER')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to create user.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Add user</DialogTitle>
          <DialogDescription>Provision a portal account with a role.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@npl.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['ADMIN', 'MANAGER', 'USER', 'VIEWER'] as Role[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    <div>
                      <p className="text-[13px] font-medium">{ROLE_LABELS[r]}</p>
                      <p className="text-[11px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Temporary password</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" />
          </div>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-[13px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
