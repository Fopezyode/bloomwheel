// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "../ISqueekCore.sol";

/// @notice Local stand-in for SqueekCore with real round timing. `run(work)` plays the hamster:
///         it settles every closed round, putting `work` into the latest one.
contract MockSqueekCore is ISqueekCore {
    CoreState private _s;
    uint64 public immutable genesis;
    uint64 public immutable duration;
    uint64 private immutable _startWork;
    RoundCheckpoint[] private _rounds; // active rounds only, ascending

    error InvalidRoundPageBounds();
    error NoClosedRound();

    constructor(uint64 startWork, uint64 roundDuration) {
        genesis = uint64(block.timestamp);
        duration = roundDuration;
        _startWork = startWork;
        _s.cumulativeWork = startWork;
        _s.cumulativeBlockUnits = uint96(startWork) * 111_000_000;
        _s.workPerThousandBlocks = 9002;
    }

    function state() external view returns (CoreState memory) {
        return _s;
    }

    function configuration() external view returns (Configuration memory c) {
        c.genesisTimestamp = genesis;
        c.roundDuration = duration;
        c.maxWorkPerRound = 10_000;
        c.maxRoundsPerBatch = 16;
    }

    function closedRound() public view returns (uint64) {
        return (uint64(block.timestamp) - genesis) / duration;
    }

    function run(uint64 work) external {
        uint64 closed = closedRound();
        if (closed <= _s.settledThroughRound) revert NoClosedRound();
        _s.settledThroughRound = closed;
        if (work == 0) return;
        _s.cumulativeWork += work;
        _s.cumulativeBlockUnits += uint96(work) * 111_087_536;
        _s.blockHeight = uint64(_s.cumulativeBlockUnits / 1_000_000_000);
        _s.blockProgress = _s.cumulativeBlockUnits % 1_000_000_000;
        // Like the reporter's signed data hash: unknown until the round settles.
        bytes32 dataHash = keccak256(abi.encode(closed, work, block.prevrandao));
        _rounds.push(RoundCheckpoint(closed, _s.cumulativeWork, _s.cumulativeBlockUnits, 9002, dataHash));
    }

    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords)
        external
        view
        returns (RoundPage memory p)
    {
        if (maxRecords == 0 || maxRecords > 16 || afterRound > throughRound || throughRound > _s.settledThroughRound) {
            revert InvalidRoundPageBounds();
        }
        p.start.cumulativeWork = _workAt(afterRound);
        RoundCheckpoint[] memory buf = new RoundCheckpoint[](maxRecords);
        uint256 n;
        for (uint256 i; i < _rounds.length && n < maxRecords; ++i) {
            uint64 id = _rounds[i].roundId;
            if (id > afterRound && id <= throughRound) buf[n++] = _rounds[i];
        }
        p.rounds = new RoundCheckpoint[](n);
        for (uint256 i; i < n; ++i) p.rounds[i] = buf[i];
        p.certifiedThroughRound = n == maxRecords ? buf[n - 1].roundId : throughRound;
        p.end.cumulativeWork = _workAt(p.certifiedThroughRound);
    }

    function _workAt(uint64 round) internal view returns (uint64 w) {
        w = _startWork;
        for (uint256 i; i < _rounds.length && _rounds[i].roundId <= round; ++i) w = _rounds[i].cumulativeWork;
    }
}
