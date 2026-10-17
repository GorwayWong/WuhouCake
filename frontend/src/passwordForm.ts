export function newPasswordError(password: string, confirmation: string): string {
  const length = Array.from(password).length;
  if (length < 8 || length > 128) return '新密码需要 8–128 个字符。';
  if (password !== confirmation) return '两次输入的新密码不一致，新密码尚未保存。';
  return '';
}
