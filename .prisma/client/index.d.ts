
declare global {
  namespace NodeJS {
    interface Global {
      __prismaClientInstance?: any;
    }
  }
}

export class PrismaClient {
  constructor(options?: any);
  [key: string]: any;
}

export {};
