import { mocked, partial } from '../../../../test/util';
import { PLATFORM_TYPE_GITHUB } from '../../../constants/platforms';
import { api } from '../../../platform/github/gh-got-wrapper';
import * as hostRules from '../../../util/host-rules';
import * as semverVersioning from '../../../versioning/semver';
import { BranchConfig } from '../../common';
import { ChangeLogError, getChangeLogJSON } from '.';

jest.mock('../../../platform/github/gh-got-wrapper');
jest.mock('../../../datasource/npm');

const ghGot = mocked(api).get;

const upgrade: BranchConfig = partial<BranchConfig>({
  endpoint: 'https://api.github.com/',
  depName: 'renovate',
  versioning: semverVersioning.id,
  fromVersion: '1.0.0',
  toVersion: '3.0.0',
  sourceUrl: 'https://github.com/chalk/chalk',
  releases: [
    { version: '0.9.0' },
    { version: '1.0.0', gitRef: 'npm_1.0.0' },
    {
      version: '2.3.0',
      gitRef: 'npm_2.3.0',
      releaseTimestamp: '2017-10-24T03:20:46.238Z',
    },
    { version: '2.2.2', gitRef: 'npm_2.2.2' },
    { version: '2.4.2', releaseTimestamp: '2017-12-24T03:20:46.238Z' },
    { version: '2.5.2' },
  ],
});

describe('workers/pr/changelog', () => {
  describe('getChangeLogJSON', () => {
    beforeEach(async () => {
      ghGot.mockClear();
      hostRules.clear();
      hostRules.add({
        hostType: PLATFORM_TYPE_GITHUB,
        baseUrl: 'https://api.github.com/',
        token: 'abc',
      });
      await global.renovateCache.rmAll();
    });
    it('returns null if @types', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          fromVersion: null,
        })
      ).toBeNull();
      expect(ghGot).toHaveBeenCalledTimes(0);
    });
    it('returns null if no fromVersion', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: 'https://github.com/DefinitelyTyped/DefinitelyTyped',
        })
      ).toBeNull();
      expect(ghGot).toHaveBeenCalledTimes(0);
    });
    it('returns null if fromVersion equals toVersion', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          fromVersion: '1.0.0',
          toVersion: '1.0.0',
        })
      ).toBeNull();
      expect(ghGot).toHaveBeenCalledTimes(0);
    });
    it('skips invalid repos', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: 'https://github.com/about',
        })
      ).toBeNull();
    });
    it('works without Github', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
        })
      ).toMatchSnapshot();
    });
    it('uses GitHub tags', async () => {
      ghGot.mockResolvedValueOnce({
        body: [
          { name: '0.9.0' },
          { name: '1.0.0' },
          { name: '1.4.0' },
          { name: 'v2.3.0' },
          { name: '2.2.2' },
          { name: 'v2.4.2' },
        ],
      } as never);
      expect(
        await getChangeLogJSON({
          ...upgrade,
        })
      ).toMatchSnapshot();
    });
    it('filters unnecessary warns', async () => {
      ghGot.mockImplementation(() => {
        throw new Error('Unknown Github Repo');
      });
      expect(
        await getChangeLogJSON({
          ...upgrade,
          depName: '@renovate/no',
        })
      ).toMatchSnapshot();
    });
    it('supports node engines', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          depType: 'engines',
        })
      ).toMatchSnapshot();
    });
    it('handles no sourceUrl', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: undefined,
        })
      ).toBeNull();
    });
    it('handles invalid sourceUrl', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: 'http://example.com',
        })
      ).toBeNull();
    });
    it('handles missing Github token', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: 'https://github.com',
        })
      ).toEqual({ error: ChangeLogError.MissingGithubToken });
    });
    it('handles no releases', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          releases: [],
        })
      ).toBeNull();
    });
    it('handles not enough releases', async () => {
      expect(
        await getChangeLogJSON({
          ...upgrade,
          releases: [{ version: '0.9.0' }],
        })
      ).toBeNull();
    });
    it('supports github enterprise and github.com changelog', async () => {
      hostRules.add({
        hostType: PLATFORM_TYPE_GITHUB,
        token: 'super_secret',
        baseUrl: 'https://github-enterprise.example.com/',
      });
      expect(
        await getChangeLogJSON({
          ...upgrade,
          endpoint: 'https://github-enterprise.example.com/',
        })
      ).toMatchSnapshot();
      expect(ghGot).toHaveBeenNthCalledWith(
        1,
        'https://api.github.com/repos/chalk/chalk/tags?per_page=100',
        { paginate: true }
      );
      expect(ghGot).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/chalk/chalk/contents/'
      );
      expect(ghGot).toHaveBeenNthCalledWith(
        3,
        'https://api.github.com/repos/chalk/chalk/releases?per_page=100'
      );
    });
    it('supports github enterprise and github enterprise changelog', async () => {
      hostRules.add({
        hostType: PLATFORM_TYPE_GITHUB,
        baseUrl: 'https://github-enterprise.example.com/',
        token: 'abc',
      });
      process.env.GITHUB_ENDPOINT = '';
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: 'https://github-enterprise.example.com/chalk/chalk',
          endpoint: 'https://github-enterprise.example.com/',
        })
      ).toMatchSnapshot();
      expect(ghGot).toHaveBeenNthCalledWith(
        1,
        'https://github-enterprise.example.com/repos/chalk/chalk/tags?per_page=100',
        { paginate: true }
      );
      expect(ghGot).toHaveBeenNthCalledWith(
        2,
        'https://github-enterprise.example.com/repos/chalk/chalk/contents/'
      );
      expect(ghGot).toHaveBeenNthCalledWith(
        3,
        'https://github-enterprise.example.com/repos/chalk/chalk/releases?per_page=100'
      );
    });

    it('supports github.com and github enterprise changelog', async () => {
      hostRules.add({
        hostType: PLATFORM_TYPE_GITHUB,
        baseUrl: 'https://github-enterprise.example.com/',
        token: 'abc',
      });
      expect(
        await getChangeLogJSON({
          ...upgrade,
          sourceUrl: 'https://github-enterprise.example.com/chalk/chalk',
        })
      ).toMatchSnapshot();
      expect(ghGot).toHaveBeenNthCalledWith(
        1,
        'https://github-enterprise.example.com/repos/chalk/chalk/tags?per_page=100',
        { paginate: true }
      );
      expect(ghGot).toHaveBeenNthCalledWith(
        2,
        'https://github-enterprise.example.com/repos/chalk/chalk/contents/'
      );
      expect(ghGot).toHaveBeenNthCalledWith(
        3,
        'https://github-enterprise.example.com/repos/chalk/chalk/releases?per_page=100'
      );
    });
  });
});
