/**
 * SOLN WALLET ACCOUNT ASSIGNMENT — PRODUCTION SAFETY TESTS
 *
 * IMPORTANT:
 * - Synthetic account numbers only.
 * - Never commit production account numbers.
 * - Routing/account identifiers remain strings.
 */

const {
  WalletAccountAllocator,
  AccountAlreadyAssignedError,
  AccountPoolExhaustedError
} = require('../src/wallet-account-assignment');

const ROUTING = '061000609';

function buildAllocator() {
  return new WalletAccountAllocator({
    routingNumber: ROUTING,

    // TEST DATA ONLY
    accounts: [
      'TEST-ACCT-000001',
      'TEST-ACCT-000002',
      'TEST-ACCT-000003'
    ]
  });
}

describe('SOLN Wallet Account Assignment', () => {

  test('assign wallet A once', async () => {

    const allocator = buildAllocator();

    const result =
      await allocator.assign('WALLET-A');

    expect(result.walletId)
      .toBe('WALLET-A');

    expect(result.routingNumber)
      .toBe('061000609');

    expect(result.accountNumber)
      .toBe('TEST-ACCT-000001');
  });


  test('wallet A always receives same account', async () => {

    const allocator = buildAllocator();

    const first =
      await allocator.assign('WALLET-A');

    const second =
      await allocator.assign('WALLET-A');

    expect(second.accountNumber)
      .toBe(first.accountNumber);

    expect(allocator.assignmentCount())
      .toBe(1);
  });


  test('wallet B receives different account', async () => {

    const allocator = buildAllocator();

    const walletA =
      await allocator.assign('WALLET-A');

    const walletB =
      await allocator.assign('WALLET-B');

    expect(walletB.accountNumber)
      .not.toBe(walletA.accountNumber);

    expect(walletB.accountNumber)
      .toBe('TEST-ACCT-000002');
  });


  test(
    'cannot assign wallet A account to wallet B',
    async () => {

      const allocator = buildAllocator();

      const walletA =
        await allocator.assign('WALLET-A');

      await expect(
        allocator.assignSpecific(
          'WALLET-B',
          walletA.accountNumber
        )
      ).rejects.toThrow(
        AccountAlreadyAssignedError
      );
    }
  );


  test(
    'simultaneous requests for same wallet produce one assignment',
    async () => {

      const allocator = buildAllocator();

      const results =
        await Promise.all([
          allocator.assign('WALLET-A'),
          allocator.assign('WALLET-A')
        ]);

      expect(results[0].accountNumber)
        .toBe(results[1].accountNumber);

      expect(allocator.assignmentCount())
        .toBe(1);

      expect(allocator.availableCount())
        .toBe(2);
    }
  );


  test(
    'simultaneous different wallets cannot receive same account',
    async () => {

      const allocator = buildAllocator();

      const results =
        await Promise.all([
          allocator.assign('WALLET-A'),
          allocator.assign('WALLET-B')
        ]);

      expect(results[0].accountNumber)
        .not.toBe(results[1].accountNumber);

      expect(allocator.assignmentCount())
        .toBe(2);
    }
  );


  test(
    'routing number preserves leading zero',
    async () => {

      const allocator = buildAllocator();

      const result =
        await allocator.assign('WALLET-A');

      expect(typeof result.routingNumber)
        .toBe('string');

      expect(result.routingNumber)
        .toBe('061000609');

      expect(result.routingNumber.length)
        .toBe(9);
    }
  );


  test(
    'exhausted pool throws clean error and never generates account',
    async () => {

      const allocator =
        new WalletAccountAllocator({
          routingNumber: ROUTING,
          accounts: [
            'TEST-ACCT-000001'
          ]
        });

      await allocator.assign('WALLET-A');

      await expect(
        allocator.assign('WALLET-B')
      ).rejects.toThrow(
        AccountPoolExhaustedError
      );

      expect(allocator.assignmentCount())
        .toBe(1);

      expect(allocator.availableCount())
        .toBe(0);
    }
  );


  test(
    'one account cannot exist in multiple wallet assignments',
    async () => {

      const allocator = buildAllocator();

      await allocator.assign('WALLET-A');
      await allocator.assign('WALLET-B');
      await allocator.assign('WALLET-C');

      const assignments =
        allocator.getAssignments();

      const accounts =
        assignments.map(
          item => item.accountNumber
        );

      expect(
        new Set(accounts).size
      ).toBe(accounts.length);
    }
  );

});
