import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { getAppConfig } from "./app.config";

export const JOB_MANAGER_CLIENT = 'JOB_MANAGER_CLIENT';

export function registerJobManagerClient() {
  return ClientsModule.registerAsync([
    {
      name: JOB_MANAGER_CLIENT,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = getAppConfig(configService);

        return {
          transport: Transport.TCP,
          options: {
            host: config.jobManager.host,
            port: config.jobManager.tcpPort,
          },
        };
      },
    },
  ]);
}