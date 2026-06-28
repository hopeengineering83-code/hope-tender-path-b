
// Minimal Prisma client stub for offline development
class PrismaClient {
  constructor(options = {}) {
    this._engineStarted = false;
    // Mock all database models and methods
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined;
        }
        if (typeof prop === 'symbol') {
          return undefined;
        }
        // Return a mock for any property access
        return new Proxy(() => {}, {
          apply: () => Promise.reject(new Error('Prisma client not fully initialized')),
          get: () => new Proxy(() => {}, {
            apply: () => Promise.reject(new Error('Prisma client not fully initialized'))
          })
        });
      }
    });
  }

  $connect() {
    return Promise.resolve();
  }

  $disconnect() {
    return Promise.resolve();
  }

  $transaction(...args) {
    if (typeof args[args.length - 1] === 'function') {
      return args[args.length - 1]();
    }
    return Promise.resolve(args[0]);
  }

  $queryRaw(...args) {
    return Promise.resolve([]);
  }

  $executeRaw(...args) {
    return Promise.resolve(0);
  }
}

const prismaClientSingleton = () => {
  return new PrismaClient();
};

const globalForPrisma = global;
const prisma = globalForPrisma.prisma || prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = {
  PrismaClient,
  prisma: prisma || new PrismaClient()
};
