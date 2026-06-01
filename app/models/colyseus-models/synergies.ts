import { MapSchema, SetSchema } from "@colyseus/schema"
import { SynergyTriggers } from "../../config"
import type { IPlayer, IPokemon } from "../../types"
import { SynergyGivenByItem } from "../../types/enum/Item"
import { Passive } from "../../types/enum/Passive"
import { Pkm, PkmFamily, PkmIndex } from "../../types/enum/Pokemon"
import { SpecialGameRule } from "../../types/enum/SpecialGameRule"
import { Synergy } from "../../types/enum/Synergy"
import { isOnBench } from "../../utils/board"
import { schemaValues } from "../../utils/schemas"
import { PVEStages } from "../pve-stages"

// 擴充 TypeScript 接口，允許我們在 pkm 物件上暫存當前的 GOD 隨機結果
declare module "../../types" {
  interface IPokemon {
    godSynergiesCache?: Map<Synergy, number>;
  }
}

export default class Synergies extends MapSchema<number, Synergy> {
  constructor(synergies?: Map<Synergy, number>) {
    super()
    Object.keys(Synergy).forEach((key) => {
      this.set(key as Synergy, synergies?.get(key as Synergy) ?? 0)
    })
  }

  hasSynergyActive(type: Synergy): boolean {
    return (this.get(type) ?? 0) >= SynergyTriggers[type][0]
  }

  hasSynergyTriggerOrMore(type: Synergy, level: number): boolean {
    return (this.get(type) ?? 0) >= SynergyTriggers[type][level - 1]
  }

  countActiveSynergies() {
    let count = 0
    this.forEach((value, synergy) => {
      if (value >= SynergyTriggers[synergy][0]) {
        count++
      }
    })
    return count
  }

  getTopSynergies(amount?: number): Synergy[] {
    const synergiesSortedByLevel: [Synergy, number][] = []
    this.forEach((value, key) => {
      synergiesSortedByLevel.push([key as Synergy, value])
    })
    synergiesSortedByLevel.sort(([s1, v1], [s2, v2]) => {
      if (v2 === v1) {
        // if equal level, prioritize the highest amount of synergy steps reached
        return (
          SynergyTriggers[s2].filter((n) => n <= v2).length -
          SynergyTriggers[s1].filter((n) => n <= v1).length
        )
      }
      return v2 - v1
    })
    if (amount) {
      return synergiesSortedByLevel.slice(0, amount).map(([s, v]) => s)
    }
    const topSynergyCount = synergiesSortedByLevel[0][1]
    const topSynergies = synergiesSortedByLevel
      .filter(([s, v]) => v >= topSynergyCount)
      .map(([s, v]) => s)
    return topSynergies
  }

  toMap() {
    const map = new Map<Synergy, number>()
    this.forEach((value, key) => {
      map.set(key as Synergy, value)
    })
    return map
  }
}

/**
 * 內部專用：獨立的 GOD 隨機刷新邏輯
 */
function rollGodSynergies(): Map<Synergy, number> {
  const godSynergies = new Map<Synergy, number>()
  const tier2Limits: Record<Synergy, number> = {
    [Synergy.NORMAL]:     6,
    [Synergy.FLYING]:     4,
    [Synergy.FIELD]:      4,
    [Synergy.DARK]:       5,
    [Synergy.GROUND]:     6,
    [Synergy.PSYCHIC]:    4,
    [Synergy.GRASS]:      6,
    [Synergy.BUG]:        6, 
    [Synergy.WATER]:      6,
    [Synergy.AQUATIC]:    4,
    [Synergy.POISON]:     5,
    [Synergy.FAIRY]:      4,
    [Synergy.FIGHTING]:   6,
    [Synergy.FIRE]:       6,
    [Synergy.GHOST]:      4,
    [Synergy.ROCK]:       4,
    [Synergy.MONSTER]:    6,
    [Synergy.AMORPHOUS]:  5,
    [Synergy.WILD]:       6,
    [Synergy.SOUND]:      4,
    [Synergy.FLORA]:      5,
    [Synergy.STEEL]:      4,
    [Synergy.ELECTRIC]:   4,
    [Synergy.ICE]:        6,
    [Synergy.BABY]:       3,
    [Synergy.HUMAN]:      4,
    [Synergy.DRAGON]:     4,
    [Synergy.LIGHT]:      4,
    [Synergy.GOURMET]:    3,
    [Synergy.FOSSIL]:     4,
    [Synergy.ARTIFICIAL]: 4
  }

  const use = Math.floor(15)
  let currentSum = 0

  const allSynergies = Object.keys(tier2Limits) as unknown as Synergy[]
  const shuffledSynergies = allSynergies.sort(() => Math.random() - 0.5)

  shuffledSynergies.forEach((synergy) => {
    if (synergy === Synergy.BUG) {
      godSynergies.set(synergy, 0)
      return
    }

    const remaining = use - currentSum
    const tier2Max = tier2Limits[synergy] || 4
    const maxAllowed = Math.min(tier2Max, remaining)

    if (maxAllowed > 0) {
      const rolled = Math.floor(Math.random() * (maxAllowed + 1))
      godSynergies.set(synergy, rolled)
      currentSum += rolled
    } else {
      godSynergies.set(synergy, 0)
    }
  })

  return godSynergies
}

export function computeSynergies(
  board: IPokemon[],
  bonusSynergies?: Map<Synergy, number>,
  specialGameRule?: SpecialGameRule | null
): Map<Synergy, number> {
  const synergies = new Map<Synergy, number>()
  Object.keys(Synergy).forEach((key) => {
    synergies.set(key as Synergy, bonusSynergies?.get(key as Synergy) ?? 0)
  })

  const typesPerFamily = new Map<string, Set<Synergy>>()

  board.forEach((pkm: IPokemon, index) => {
    // reset dynamic synergies
    if (pkm.passive === Passive.PROTEAN2 || pkm.passive === Passive.PROTEAN3) {
      pkm.types.clear()
    }

    addSynergiesGivenByItems(pkm)
    if (pkm.positionY != 0 && pkm.passive !== Passive.GOD) {
      const family =
        specialGameRule === SpecialGameRule.FAMILY_OUTING
          ? `pkm${index}`
          : PkmFamily[pkm.name]
      if (!typesPerFamily.has(family)) typesPerFamily.set(family, new Set())
      const types: Set<Synergy> = typesPerFamily.get(family)!
      pkm.types.forEach((type) => types.add(type))
    }
  })

  typesPerFamily.forEach((types) => {
    types.forEach((type, i) => {
      synergies.set(type, (synergies.get(type) ?? 0) + 1)
    })
  })

  // GOD passive 改良邏輯：放上場時才隨機重新整理
  board.forEach((pkm: IPokemon) => {
    if (pkm.passive === Passive.GOD) {
      if (pkm.positionY !== 0) {
        // 情況 A：寶可夢在場上（放上去狀態）
        // 如果還沒有快取，代表是「剛被放上去」的那一刻，觸發隨機刷新
        if (!pkm.godSynergiesCache) {
          pkm.godSynergiesCache = rollGodSynergies()
        }
        
        // 累加這隻寶可夢身上固定的隨機結果（後續對戰或重複計算時，都不會再走 roll 邏輯）
        pkm.godSynergiesCache.forEach((value, synergy) => {
          synergies.set(synergy, (synergies.get(synergy) ?? 0) + value)
        })
      } else {
        // 情況 B：寶可夢回到了備戰區 (positionY === 0)
        // 清空快取，這樣下次再次「放上去」時，就能重新觸發刷新
        pkm.godSynergiesCache = undefined
      }
    }
  })

  function applyDragonDoubleTypes() {
    const dragonDoubleTypes = new Map<string, Set<Synergy>>()
    board.forEach((pkm: IPokemon, index) => {
      if (
        pkm.positionY != 0 &&
        pkm.types.has(Synergy.DRAGON) &&
        pkm.types.size > 1
      ) {
        const family =
          specialGameRule === SpecialGameRule.FAMILY_OUTING
            ? `pkm${index}`
            : PkmFamily[pkm.name]
        if (!dragonDoubleTypes.has(family))
          dragonDoubleTypes.set(family, new Set())
        dragonDoubleTypes.get(family)!.add(schemaValues(pkm.types)[1])
      }
    })
    dragonDoubleTypes.forEach((types) => {
      types.forEach((type, i) => {
        synergies.set(type, (synergies.get(type) ?? 0) + 1)
      })
    })
  }

  if (
    (synergies.get(Synergy.DRAGON) ?? 0) >= SynergyTriggers[Synergy.DRAGON][0]
  ) {
    applyDragonDoubleTypes()
  }

  // add dynamic synergies (Arceus & Kecleon)
  board.forEach((pkm: IPokemon) => {
    if (
      pkm.positionY !== 0 &&
      (pkm.passive === Passive.PROTEAN2 || pkm.passive === Passive.PROTEAN3)
    ) {
      const nbDynamicSynergies = pkm.passive === Passive.PROTEAN3 ? 3 : 2
      const synergiesSorted = [...synergies.keys()].sort(
        (a, b) => +synergies.get(b)! - +synergies.get(a)!
      )

      if (
        synergiesSorted.slice(0, nbDynamicSynergies).includes(Synergy.DRAGON)
      ) {
        // if dragon is in the top synergies, we need to ensure it is the first one
        const dragonIndex = synergiesSorted.indexOf(Synergy.DRAGON)
        if (dragonIndex > 0) {
          synergiesSorted.splice(dragonIndex, 1)
          synergiesSorted.unshift(Synergy.DRAGON)
        }
      }

      let shouldComputeDragonDoubleTypeAgain = false
      for (let i = 0; i < nbDynamicSynergies; i++) {
        const type = synergiesSorted[i]
        if (type && !pkm.types.has(type) && synergies.get(type)! > 0) {
          pkm.types.add(type)
          synergies.set(type, (synergies.get(type) ?? 0) + 1)
          //apply dragon double synergies just for Arceus & Kecleon if Dragon
          if (type === Synergy.DRAGON) {
            if (
              synergies.get(Synergy.DRAGON) ===
              SynergyTriggers[Synergy.DRAGON][0]
            ) {
              // Arceus/Kecleon just activated Dragon 3, so we need to apply the double synergies to all pokemons
              shouldComputeDragonDoubleTypeAgain = true
            } else if (
              synergies.get(Synergy.DRAGON)! >
              SynergyTriggers[Synergy.DRAGON][0]
            ) {
              // Dragon 3 was already activated, so we just need to double the synergy of Arceus/Kecleon
              const doubledType = synergiesSorted[1]
              synergies.set(doubledType, (synergies.get(doubledType) ?? 0) + 1)
            }
          }
        }
      }

      if (shouldComputeDragonDoubleTypeAgain) {
        applyDragonDoubleTypes()
      }

      if (pkm.name.startsWith("ARCEUS")) {
        switch (schemaValues(pkm.types)[0]) {
          case Synergy.BUG:
            pkm.index = PkmIndex[Pkm.ARCEUS_BUG]
            break
          case Synergy.DARK:
            pkm.index = PkmIndex[Pkm.ARCEUS_DARK]
            break
          case Synergy.DRAGON:
          case Synergy.FOSSIL:
            pkm.index = PkmIndex[Pkm.ARCEUS_DRAGON]
            break
          case Synergy.ELECTRIC:
            pkm.index = PkmIndex[Pkm.ARCEUS_ELECTRIC]
            break
          case Synergy.FIGHTING:
          case Synergy.WILD:
            pkm.index = PkmIndex[Pkm.ARCEUS_FIGHTING]
            break
          case Synergy.FIRE:
          case Synergy.GOURMET:
            pkm.index = PkmIndex[Pkm.ARCEUS_FIRE]
            break
          case Synergy.FLYING:
            pkm.index = PkmIndex[Pkm.ARCEUS_FLYING]
            break
          case Synergy.GHOST:
            pkm.index = PkmIndex[Pkm.ARCEUS_GHOST]
            break
          case Synergy.GRASS:
          case Synergy.FLORA:
            pkm.index = PkmIndex[Pkm.ARCEUS_GRASS]
            break
          case Synergy.GROUND:
          case Synergy.FIELD:
            pkm.index = PkmIndex[Pkm.ARCEUS_GROUND]
            break
          case Synergy.ICE:
            pkm.index = PkmIndex[Pkm.ARCEUS_ICE]
            break
          case Synergy.POISON:
          case Synergy.MONSTER:
            pkm.index = PkmIndex[Pkm.ARCEUS_POISON]
            break
          case Synergy.PSYCHIC:
          case Synergy.SOUND:
            pkm.index = PkmIndex[Pkm.ARCEUS_PSYCHIC]
            break
          case Synergy.ROCK:
            pkm.index = PkmIndex[Pkm.ARCEUS_ROCK]
            break
          case Synergy.STEEL:
          case Synergy.ARTIFICIAL:
            pkm.index = PkmIndex[Pkm.ARCEUS_STEEL]
            break
          case Synergy.WATER:
          case Synergy.AQUATIC:
            pkm.index = PkmIndex[Pkm.ARCEUS_WATER]
            break
          case Synergy.FAIRY:
          case Synergy.AMORPHOUS:
            pkm.index = PkmIndex[Pkm.ARCEUS_FAIRY]
            break
        }
      }
    }
  })

  return synergies
}

export function addSynergiesGivenByItems(pkm: IPokemon) {
  pkm.items.forEach((item) => {
    const synergy = SynergyGivenByItem[item]
    if (synergy) {
      if (synergy === Synergy.DRAGON) {
        pkm.types = new SetSchema<Synergy>([synergy, ...pkm.types])
      } else {
        pkm.types.add(synergy)
      }
    }
  })
}

export function getSynergyStep(
  synergies: Map<Synergy, number> | MapSchema<number, Synergy>,
  type: Synergy
): number {
  return SynergyTriggers[type].filter((n) => (synergies.get(type) ?? 0) >= n)
    .length
}

export function getWildChance(player: IPlayer, stageLevel: number): number {
  const isPVE = stageLevel === 0 || stageLevel in PVEStages
  const wildLevel = getSynergyStep(player.synergies, Synergy.WILD)
  // 6% base chance in PvE stage or if Wild is active
  const baseChance = isPVE || wildLevel > 0 ? 6 : 0
  // each star of a pokemon with wild synergy gives 0.5% wild chance
  const nbWildStars = schemaValues(player.board)
    .filter((p) => p.types.has(Synergy.WILD) && isOnBench(p) === false)
    .reduce((total, p) => total + p.stars, 0)
  const bonusChance = wildLevel > 0 ? nbWildStars * 0.5 : 0
  return (baseChance + bonusChance) / 100
}