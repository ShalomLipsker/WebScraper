import { ConfigModule, type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { apiJobManagerConfig } from './app.config';

export const JOB_MANAGER_CLIENT = 'JOB_MANAGER_CLIENT';

export function registerJobManagerClient() {
  return ClientsModule.registerAsync([
    {
      name: JOB_MANAGER_CLIENT,
      imports: [ConfigModule],
      inject: [apiJobManagerConfig.KEY],
      useFactory: (...args: unknown[]) => {
        const [jobManagerConfig] = args as [ConfigType<typeof apiJobManagerConfig>];

        return {
          transport: Transport.TCP,
          options: {
            host: jobManagerConfig.host,
            port: jobManagerConfig.tcpPort,
          },
        };
      },
    },
  ]);
}