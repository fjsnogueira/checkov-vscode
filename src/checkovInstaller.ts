import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from 'winston';
import { asyncExec, isWindows } from './utils';

const isCurlKicsInstalledGlobally = async () => {
    try {
        await asyncExec('kics --version');
        return true;
    } catch (err) {
        return false;
    }
};

const isPipCheckovInstalledGlobally = async () => {
    try {
        await asyncExec('checkov --version');
        return true;
    } catch (err) {
        return false;
    }
};

const getCurlKicsExecutablePath = async (logger: Logger): Promise<string> => {
    if (!isWindows) {
        const [pythonUserBaseOutput] = await asyncExec('python3 -c "import site; print(site.USER_BASE)"');
        logger.debug(`User base output: ${pythonUserBaseOutput}`);
        return path.join(pythonUserBaseOutput.trim(), 'bin', 'kics');
    } else {
        // Windows has issues with the approach above (no surprise), but we can get to site-packages and from there to the executable
        const [showCheckovOutput] = await asyncExec('pip3 show checkov');
        for (const line of showCheckovOutput.split(os.EOL)) {
            if (line.startsWith('Location: ')) {
                logger.debug(line);
                const sitePackagePath = line.split(' ')[1];
                return path.join(path.dirname(sitePackagePath), 'Scripts', 'checkov');
            }
        }
    }

    throw new Error('Failed to find the path to the non-global kics executable');
};

const getPipCheckovExecutablePath = async (logger: Logger): Promise<string> => {
    if (!isWindows) {
        const [pythonUserBaseOutput] = await asyncExec('python3 -c "import site; print(site.USER_BASE)"');
        logger.debug(`User base output: ${pythonUserBaseOutput}`);
        return path.join(pythonUserBaseOutput.trim(), 'bin', 'checkov');
    } else {
        // Windows has issues with the approach above (no surprise), but we can get to site-packages and from there to the executable
        const [showCheckovOutput] = await asyncExec('pip3 show checkov');
        for (const line of showCheckovOutput.split(os.EOL)) {
            if (line.startsWith('Location: ')) {
                logger.debug(line);
                const sitePackagePath = line.split(' ')[1];
                return path.join(path.dirname(sitePackagePath), 'Scripts', 'checkov');
            }
        }
    }

    throw new Error('Failed to find the path to the non-global checkov executable');
};

const installOrUpdateKicsWithCurl = async (logger: Logger, kicsVersion: string): Promise<string | null> => {
    logger.info('Trying to install Kics using curl.');

    kicsVersion = '1.4.8';

    try {
        const command = 
        'wget --quiet "curl -s https://github.com/Checkmarx/kics/releases/download/'+kicsVersion+'/kics_'+kicsVersion+'_linux_x64.tar.gz"\n' +
        'mkdir -p kics_zip\n' +
        'tar xfz kics*_linux_x64.tar.gz -C kics_zip\n' +
        'zip -qr kics.zip kics_zip\n';

        logger.debug(`Testing kics curl installation with command: ${command}`);
        
        await asyncExec(command);

        let kicsPath;
        if (await isCurlKicsInstalledGlobally()) {
            kicsPath = 'kics';
        } else {
            kicsPath = await getCurlKicsExecutablePath(logger);
        }
        logger.info('Kics installed successfully using curl.', { checkovPath: kicsPath });
        return kicsPath;
    } catch (error) {
        logger.error('Failed to install or update kics using curl. Error:', { error });
        return null;
    }
};

const installOrUpdateCheckovWithPip3 = async (logger: Logger, checkovVersion: string): Promise<string | null> => {
    logger.info('Trying to install Checkov using pip3.');

    try {
        const command = `pip3 install --user -U -i https://pypi.org/simple/ checkov${checkovVersion === 'latest' ? '' : `==${checkovVersion}`}`;
        logger.debug(`Testing pip3 installation with command: ${command}`);
        await asyncExec(command);

        let checkovPath;
        if (await isPipCheckovInstalledGlobally()) {
            checkovPath = 'checkov';
        } else {
            checkovPath = await getPipCheckovExecutablePath(logger);
        }
        logger.info('Checkov installed successfully using pip3.', { checkovPath });
        return checkovPath;
    } catch (error) {
        logger.error('Failed to install or update Checkov using pip3. Error:', { error });
        return null;
    }
};

const getPipenvPythonExecutableLocation = async (logger: Logger, cwd: string): Promise<string> => {
    const getExeCommand = isWindows ? 'pipenv run where python': 'pipenv run which python';
    logger.debug(`Getting pipenv executable with command: ${getExeCommand}`);
    const [execOutput] = await asyncExec(getExeCommand, { cwd });

    if (!isWindows) {
        return execOutput;
    } else {
        return execOutput.split(os.EOL)[0]; // Windows returns all results from the path
    }
};

const installOrUpdateCheckovWithPipenv = async (logger: Logger, installationDir: string, checkovVersion: string): Promise<string | null> => {
    
    logger.info('Trying to install Checkov using pipenv.');

    try {
        fs.mkdirSync(installationDir, { recursive: true });
        logger.debug(`Installation dir: ${installationDir}`);
        const installCommand = `pipenv --python 3 install checkov${checkovVersion && checkovVersion.toLowerCase() !== 'latest' ? `==${checkovVersion}` : '~=2.0.0'}`;
        logger.debug(`Testing pipenv installation with command: ${installCommand}`);
        await asyncExec(installCommand, { cwd: installationDir });

        const execOutput = await getPipenvPythonExecutableLocation(logger, installationDir);
        logger.debug(`pipenv python executable: ${execOutput}`);

        const checkovPath = `"${path.join(path.dirname(execOutput), 'checkov')}"`;
        logger.info('Checkov installed successfully using pipenv.', { checkovPath, installationDir });
        return checkovPath;
    } catch (error) {
        logger.error('Failed to install or update Checkov using pipenv. Error:', { error });
        return null;
    }
};

const installOrUpdateKicsWithDocker = async (logger: Logger, kicsVersion: string): Promise<string | null> => {
    
    logger.info('Trying to install Checkov using Docker.');
    try {
        const command = `docker pull bridgecrew/checkov:${kicsVersion}`;
        logger.debug(`Testing docker installation with command: ${command}`);
        await asyncExec(command);
        
        const kicsPath = 'docker';
        logger.info('Kics installed successfully using Docker.', { kicsPath });
        return kicsPath;
    } catch (error) {
        logger.error('Failed to install or update Kics using Docker. Error: ', { error });
        return null;
    }
};

const installOrUpdateCheckovWithDocker = async (logger: Logger, checkovVersion: string): Promise<string | null> => {
    
    logger.info('Trying to install Checkov using Docker.');
    try {
        const command = `docker pull bridgecrew/checkov:${checkovVersion}`;
        logger.debug(`Testing docker installation with command: ${command}`);
        await asyncExec(command);
        
        const checkovPath = 'docker';
        logger.info('Checkov installed successfully using Docker.', { checkovPath });
        return checkovPath;
    } catch (error) {
        logger.error('Failed to install or update Checkov using Docker. Error: ', { error });
        return null;
    }
};

type KicsInstallationMethod = 'curl' | 'docker';
export interface KicsInstallation {
    kicsInstallationMethod: KicsInstallationMethod;
    kicsPath: string;
    version?: string;
}

type CheckovInstallationMethod = 'pip3' | 'pipenv' | 'docker';
export interface CheckovInstallation {
    checkovInstallationMethod: CheckovInstallationMethod;
    checkovPath: string;
    version?: string;
}

export const installOrUpdateCheckov = async (logger: Logger, installationDir: string, checkovVersion: string): Promise<CheckovInstallation> => {
    const dockerCheckovPath = await installOrUpdateCheckovWithDocker(logger, checkovVersion);
    if (dockerCheckovPath) return { checkovInstallationMethod: 'docker' , checkovPath: dockerCheckovPath };
    const pip3CheckovPath = await installOrUpdateCheckovWithPip3(logger, checkovVersion);
    if (pip3CheckovPath) return { checkovInstallationMethod: 'pip3' , checkovPath: pip3CheckovPath };
    const pipenvCheckovPath = await installOrUpdateCheckovWithPipenv(logger, installationDir, checkovVersion);
    if (pipenvCheckovPath) return { checkovInstallationMethod: 'pipenv' , checkovPath: pipenvCheckovPath };

    throw new Error('Could not install Checkov.');
};

export const installOrUpdateKics = async (logger: Logger, installationDir: string, kicsVersion: string): Promise<KicsInstallation> => {
    const dockerKicsPath = await installOrUpdateKicsWithDocker(logger, kicsVersion);
    if (dockerKicsPath) return { kicsInstallationMethod: 'docker' , kicsPath: dockerKicsPath };
    const curlKicsPath = await installOrUpdateKicsWithCurl(logger, kicsVersion);
    if (curlKicsPath) return { kicsInstallationMethod: 'curl' , kicsPath: curlKicsPath };
    throw new Error('Could not install Checkov.');
};
