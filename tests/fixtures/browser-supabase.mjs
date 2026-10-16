const profile = {
  id: 'browser-test-user',
  email: 'browser@example.test',
  display_name: '브라우저 검증 사용자',
  role: 'editor',
  active: true,
};
const session = () =>
  localStorage.getItem('browser-test-session')
    ? { user: profile, access_token: 'mock-only' }
    : null;
const course = {
  stop_id: 'test-stop',
  route_id: 'test-route',
  center_code: '001',
  route_name: '검증 코스',
  dp_name: '브라우저 검증 납품처',
  dp_code: 'TEST-001',
  company_name: '검증 운수사',
  primary_driver_name: '검증 기사',
  stop_order: 1,
};

function query(table) {
  let single = false;
  let start = 0;
  let end = Infinity;
  const result = new Proxy(
    {},
    {
      get(target, property) {
        if (property === 'then') {
          return (callback) =>
            Promise.resolve(
              callback({
                data:
                  table === 'user_profiles'
                    ? single
                      ? profile
                      : [profile]
                    : table === 'course_view'
                      ? [course].slice(start, end + 1)
                      : [],
                error: null,
              }),
            );
        }
        if (['insert', 'update', 'upsert', 'delete'].includes(property)) {
          return () => {
            throw new Error('Database writes are forbidden in browser tests');
          };
        }
        if (property === 'range') {
          return (from, through) => {
            start = from;
            end = through;
            return result;
          };
        }
        if (property === 'single' || property === 'maybeSingle') {
          return () => {
            single = true;
            return result;
          };
        }
        return () => result;
      },
    },
  );
  return result;
}

export const supabase = {
  from: query,
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    getUser: async () => ({
      data: { user: session()?.user ?? null },
      error: null,
    }),
    signInWithPassword: async ({ email, password }) => {
      if (email !== profile.email || password !== 'browser-test-password') {
        return { data: {}, error: { message: 'Invalid login credentials' } };
      }
      localStorage.setItem('browser-test-session', 'active');
      return { data: { user: profile, session: session() }, error: null };
    },
    signOut: async () => {
      localStorage.removeItem('browser-test-session');
      return { error: null };
    },
  },
  rpc: async (name) => {
    if (name === 'operations_portal_context') {
      return {
        data: {
          centers: [{ code: '001', name: '사조안산' }],
          writable_centers: ['001'],
        },
        error: null,
      };
    }
    if (name === 'operations_permissions_context') {
      return {
        data: {
          access: {
            tasks: {
              read: true,
              edit: true,
              read_centers: ['001'],
              edit_centers: ['001'],
            },
          },
        },
        error: null,
      };
    }
    if (name === 'operations_participant_options')
      return { data: [], error: null };
    throw new Error('Unexpected RPC in browser test: ' + name);
  },
  functions: {
    invoke: async () => {
      throw new Error('External functions are forbidden in browser tests');
    },
  },
};
