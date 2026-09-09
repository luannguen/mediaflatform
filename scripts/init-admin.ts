import { supabaseAdmin, isSupabaseAdminConfigured } from '../src/lib/supabase/admin';

async function initAdmin() {
  console.log('Provisioning Super Admin account in Supabase Auth...');

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME || 'Super Admin (Owner)';

  if (!adminEmail || !adminPassword) {
    console.error('Error: ADMIN_EMAIL and ADMIN_PASSWORD must be defined in environment variables.');
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    console.log('Supabase admin not configured, skipping remote Supabase Auth provision.');
    return;
  }

  // 1. Try to create user in Supabase Auth
  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: {
      full_name: adminName,
      role: 'owner',
    },
  });

  if (createError) {
    if (createError.message.toLowerCase().includes('already') || (createError as any).status === 422) {
      console.log(`User ${adminEmail} already exists in Supabase Auth. Updating password and metadata...`);
      // Find user ID
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      const existing = listData.users.find((u) => u.email === adminEmail);
      if (existing) {
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          password: adminPassword,
          email_confirm: true,
          user_metadata: {
            full_name: adminName,
            role: 'owner',
          },
        });
        if (updateError) {
          console.warn('Could not update password:', updateError.message);
        } else {
          console.log(`✅ Successfully updated password and metadata for ${adminEmail}`);
        }
      }
    } else {
      console.warn('Supabase Auth createUser warning:', createError.message);
    }
  } else {
    console.log(`✅ Successfully created Super Admin ${adminEmail} (ID: ${createData.user.id}) in Supabase Auth!`);
  }
}

initAdmin().catch(console.error);
