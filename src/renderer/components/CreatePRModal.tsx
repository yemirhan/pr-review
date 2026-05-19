import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, GitPullRequest, Loader2 } from 'lucide-react';
import { api, unwrap, ApiError } from '../lib/api';
import type { Repo } from '@shared/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Button } from './ui/button';

export function CreatePRModal({
  repo,
  open,
  onOpenChange,
  onCreated
}: {
  repo: Repo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (prNumber: number) => void;
}) {
  const branchesQ = useQuery({
    queryKey: ['branches', repo.id],
    queryFn: () => unwrap(api.prs.branches(repo.id)),
    enabled: open
  });

  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset when reopened.
  useEffect(() => {
    if (!open) {
      setTitle('');
      setBody('');
      setHead('');
      setDraft(false);
      setErr(null);
    }
  }, [open]);

  // Initialize base to repo default once branches load.
  useEffect(() => {
    if (branchesQ.data && !base) {
      setBase(branchesQ.data.defaultBranch);
    }
  }, [branchesQ.data, base]);

  const branches = useMemo(() => {
    const all = branchesQ.data?.branches ?? [];
    const priority = ['develop', 'master', 'main'];
    const pinned = priority.filter((p) => all.includes(p));
    const rest = all.filter((b) => !pinned.includes(b)).sort((a, b) => a.localeCompare(b));
    return [...pinned, ...rest];
  }, [branchesQ.data]);

  const canSubmit =
    !!title.trim() && !!base && !!head && base !== head && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const num = await unwrap(
        api.prs.create(repo.id, {
          base,
          head,
          title: title.trim(),
          body,
          draft
        })
      );
      onCreated(num);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 text-accent" />
            New pull request
          </DialogTitle>
          <DialogDescription>
            {repo.owner}/{repo.name}
          </DialogDescription>
        </DialogHeader>

        {branchesQ.isLoading && (
          <div className="flex items-center gap-2 text-2xs text-fg-muted mb-3">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading branches…
          </div>
        )}
        {branchesQ.error && (
          <div className="text-2xs text-danger mb-3">
            {(branchesQ.error as ApiError).message || 'Failed to load branches'}
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 mb-4">
          <BranchSelect
            label="Base"
            value={base}
            onChange={setBase}
            options={branches}
            placeholder="base branch"
            disabled={branchesQ.isLoading}
          />
          <div className="pb-2 text-fg-subtle">←</div>
          <BranchSelect
            label="Compare"
            value={head}
            onChange={setHead}
            options={branches.filter((b) => b !== base)}
            placeholder="head branch"
            disabled={branchesQ.isLoading}
          />
        </div>

        <div className="space-y-1.5 mb-3">
          <Label htmlFor="pr-title">Title</Label>
          <Input
            id="pr-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of the change"
            autoFocus
          />
        </div>

        <div className="space-y-1.5 mb-4">
          <Label htmlFor="pr-body">Description</Label>
          <Textarea
            id="pr-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Markdown supported"
            className="min-h-[140px] font-mono text-2xs"
          />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <Checkbox
            id="pr-draft"
            checked={draft}
            onCheckedChange={(v) => setDraft(v === true)}
          />
          <Label htmlFor="pr-draft" className="normal-case tracking-normal text-sm font-normal text-fg cursor-pointer">
            Create as draft
          </Label>
        </div>

        {err && (
          <div className="mt-3 text-2xs text-danger bg-danger-subtle border border-danger-emphasis/40 rounded px-2 py-1.5">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? 'Creating…' : draft ? 'Create draft PR' : 'Create PR'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="font-mono text-2xs">
          <GitBranch className="h-3.5 w-3.5 opacity-60 shrink-0 mr-1.5" />
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((b) => (
            <SelectItem key={b} value={b} className="font-mono text-2xs">
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
