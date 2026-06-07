-- Fix: Create "Personal" organization, membership, and default project
-- for users who signed up before the handle_new_user trigger was applied.
--
-- This finds all users in auth.users that do NOT have an organization_members
-- row and bootstraps them.

DO $$
DECLARE
  rec record;
  v_org_id  uuid;
  v_proj_id uuid;
BEGIN
  FOR rec IN
    SELECT u.id, u.email
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om."userId" = u.id
    )
  LOOP
    v_org_id  := gen_random_uuid();
    v_proj_id := gen_random_uuid();

    -- Create profile (skip if already exists)
    INSERT INTO public.profiles (id, email)
    VALUES (rec.id, rec.email)
    ON CONFLICT (id) DO NOTHING;

    -- Create personal organization
    INSERT INTO public.organizations (id, name, slug, "ownerId")
    VALUES (v_org_id, 'Personal', 'personal-' || rec.id::text, rec.id)
    ON CONFLICT (slug) DO NOTHING;

    IF FOUND THEN
      -- Add owner membership
      INSERT INTO public.organization_members ("workspaceId", "userId", role)
      VALUES (v_org_id, rec.id, 'OWNER');

      -- Create default project
      INSERT INTO public.projects (id, "organizationId", name, "createdBy")
      VALUES (v_proj_id, v_org_id, 'Default', rec.id);

      RAISE NOTICE 'Bootstrapped org for user %', rec.email;
    END IF;
  END LOOP;
END;
$$;
