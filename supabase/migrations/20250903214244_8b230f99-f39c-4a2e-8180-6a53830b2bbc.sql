-- Create a test admin user that's already confirmed for immediate login testing
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmed_at,
  created_at,
  updated_at,
  raw_user_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'test-admin-uuid-123456789012345',
  'authenticated',
  'authenticated',
  'test@admin.com',
  crypt('admin123', gen_salt('bf')),
  now(),
  now(),
  now(),
  now(),
  '{"full_name": "Test Admin"}'::jsonb
) ON CONFLICT (email) DO NOTHING;