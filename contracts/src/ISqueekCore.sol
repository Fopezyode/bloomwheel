// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The slice of SqueekCore (Sepolia 0xFD6C166D4B8E2962E65746a13e5a0797cd4dE0c4)
///         that Bloomwheel reads. Tuples match the published SqueekCore ABI.
interface ISqueekCore {
    struct CoreState {
        uint64 settledThroughRound;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint64 blockHeight;
        uint96 blockProgress;
        uint32 workPerThousandBlocks;
        uint256 authorizationNonce;
        bool paused;
    }

    struct Configuration {
        bytes32 streamId;
        uint64 genesisTimestamp;
        uint64 roundDuration;
        uint64 maxWorkPerRound;
        uint16 maxRoundsPerBatch;
        address guardian;
        address reporter;
        uint32 initialWorkPerThousandBlocks;
        uint64 targetBlocksPerActiveRound;
        uint64 difficultySmoothingRounds;
        uint96 blockUnitsPerBlock;
    }

    struct LedgerPosition {
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
    }

    struct RoundCheckpoint {
        uint64 roundId;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint32 workPerThousandBlocks;
        bytes32 dataHash;
    }

    /// Only rounds with work appear in `rounds`. `certifiedThroughRound` is how far the page reaches.
    struct RoundPage {
        uint64 certifiedThroughRound;
        LedgerPosition start;
        LedgerPosition end;
        RoundCheckpoint[] rounds;
    }

    function state() external view returns (CoreState memory);
    function configuration() external view returns (Configuration memory);
    /// maxRecords must be 1..16 and throughRound <= settledThroughRound.
    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) external view returns (RoundPage memory);
}
