export class StringUtils {
  static generateRandomString(strLength: number) {
    const characters =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let randomString = '';
    for (let index = 0; index < strLength; index++) {
      randomString +=
        characters[Math.floor(Math.random() * (characters.length - 1 - 0) + 0)];
    }
    return randomString;
  }

  static generateRandomStringNumber(strLength: number): string {
    const characters = '0123456789';
    let randomString = '';
    for (let index = 0; index < strLength; index++) {
      randomString +=
        characters[Math.floor(Math.random() * (characters.length - 1 - 0) + 0)];
    }

    return randomString;
  }

  static removeVietnameseAccents(str: Optional<string>) {
    if (!str) {
      return str;
    }

    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }
}
