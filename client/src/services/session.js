const key = 'mysql_admin_token';

export const getToken = () => sessionStorage.getItem(key);
export const clearToken = () => sessionStorage.removeItem(key);
export const saveToken = (token) => {
  if (typeof token !== 'string' || !token) throw new Error('Login did not return a session token. Deploy the updated server.');
  sessionStorage.setItem(key, token);
};
