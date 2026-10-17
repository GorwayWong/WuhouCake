export function newPasswordError(password: string, confirmation: string): string {
  const length = Array.from(password).length;
  if (length < 15 || length > 128) return '新密码需要 15–128 个字符。';
  if (password !== confirmation) return '两次输入的新密码不一致，新密码尚未保存。';
  return '';
}
