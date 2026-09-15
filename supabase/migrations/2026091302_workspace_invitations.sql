CREATE TABLE public.workspace_invitations (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 workspace_name text NOT NULL, inviter_user_id text NOT NULL, inviter_name text NOT NULL,
 invitee_email text NOT NULL CHECK(invitee_email=lower(trim(invitee_email))),
 role text NOT NULL CHECK(role IN ('admin','media_manager','editor','uploader','viewer','developer')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','revoked')),
 accepted_by text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE UNIQUE INDEX workspace_invitation_pending ON public.workspace_invitations(workspace_id,invitee_email) WHERE status='pending';
CREATE INDEX workspace_invitation_email ON public.workspace_invitations(invitee_email,status);
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_invitations FROM anon,authenticated;
GRANT ALL ON public.workspace_invitations TO service_role;

CREATE FUNCTION public.invite_workspace_member(p_workspace_id text,p_inviter_id text,p_email text,p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.workspaces; result public.workspace_invitations; inviter_role text;
BEGIN
 SELECT * INTO w FROM public.workspaces WHERE id=p_workspace_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;
 SELECT role_id INTO inviter_role FROM public.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_inviter_id AND status='active';
 IF inviter_role NOT IN ('role_owner','role_admin') OR inviter_role IS NULL THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;
 IF p_role NOT IN ('admin','media_manager','editor','uploader','viewer','developer') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
 p_email:=lower(trim(p_email));
 IF length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_memberships m JOIN auth.users u ON u.id::text=m.user_id WHERE m.workspace_id=p_workspace_id AND lower(u.email)=p_email AND m.status='active') THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
 UPDATE public.workspace_invitations SET status='revoked' WHERE workspace_id=p_workspace_id AND invitee_email=p_email AND status='pending' AND expires_at<=now();
 INSERT INTO public.workspace_invitations(id,workspace_id,workspace_name,inviter_user_id,inviter_name,invitee_email,role)
 VALUES('inv_'||gen_random_uuid()::text,p_workspace_id,w.name,p_inviter_id,'Workspace Admin',p_email,p_role)
 ON CONFLICT(workspace_id,invitee_email) WHERE status='pending' DO UPDATE SET role=workspace_invitations.role RETURNING * INTO result;
 RETURN to_jsonb(result);
END $$;

CREATE FUNCTION public.respond_workspace_invitation(p_invitation_id text,p_user_id text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inv public.workspace_invitations; user_email text;
BEGIN
 SELECT lower(email) INTO user_email FROM auth.users WHERE id::text=p_user_id AND email_confirmed_at IS NOT NULL AND (banned_until IS NULL OR banned_until<now());
 IF user_email IS NULL THEN RAISE EXCEPTION 'VERIFIED_IDENTITY_REQUIRED'; END IF;
 SELECT * INTO inv FROM public.workspace_invitations WHERE id=p_invitation_id AND invitee_email=user_email FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND'; END IF;
 IF p_action NOT IN ('accepted','declined') THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
 IF inv.status=p_action AND (p_action='declined' OR inv.accepted_by=p_user_id) THEN RETURN to_jsonb(inv); END IF;
 IF inv.status<>'pending' OR inv.expires_at<=now() THEN RAISE EXCEPTION 'INVITATION_EXPIRED_OR_PROCESSED'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=inv.workspace_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED'; END IF;
 IF p_action='accepted' THEN
  INSERT INTO public.workspace_memberships(id,workspace_id,user_id,role_id,status,invited_by,joined_at)
  VALUES('mem_'||gen_random_uuid()::text,inv.workspace_id,p_user_id,'role_'||inv.role,'active',inv.inviter_user_id,now())
  ON CONFLICT(workspace_id,user_id) DO UPDATE SET role_id=CASE WHEN workspace_memberships.status='active' THEN workspace_memberships.role_id ELSE excluded.role_id END,status='active',updated_at=now();
 END IF;
 UPDATE public.workspace_invitations SET status=p_action,accepted_by=CASE WHEN p_action='accepted' THEN p_user_id ELSE NULL END WHERE id=inv.id RETURNING * INTO inv;
 RETURN to_jsonb(inv);
END $$;
REVOKE ALL ON FUNCTION public.invite_workspace_member(text,text,text,text),public.respond_workspace_invitation(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invite_workspace_member(text,text,text,text),public.respond_workspace_invitation(text,text,text) TO service_role;
