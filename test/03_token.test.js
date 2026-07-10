const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SlvrToken — minting & trade tax", () => {
  async function deploy() {
    const [owner, minter, pair, alice, bob, jackpot] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SlvrToken");
    const token = await Token.deploy(owner.address);
    await token.waitForDeployment();
    return { owner, minter, pair, alice, bob, jackpot, token };
  }

  it("only the minter can mint, and the minter can be set once then locked", async () => {
    const { owner, minter, alice, token } = await deploy();
    await expect(token.connect(alice).mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "NotMinter");

    await token.connect(owner).setMinter(minter.address);
    await expect(token.connect(owner).setMinter(alice.address)).to.be.revertedWithCustomError(token, "MinterAlreadySet");

    await token.connect(minter).mint(alice.address, ethers.parseEther("100"));
    expect(await token.balanceOf(alice.address)).to.eq(ethers.parseEther("100"));

    await token.connect(owner).lockMinter();
    // even though setMinter would revert on AlreadySet, lock is the permanent guarantee
    expect(await token.minterLocked()).to.eq(true);
  });

  it("taxes buys and sells through an AMM pair, but not ordinary transfers", async () => {
    const { owner, minter, pair, alice, bob, jackpot, token } = await deploy();
    await token.connect(owner).setMinter(minter.address);
    await token.connect(owner).setTaxRecipient(jackpot.address);
    await token.connect(owner).setTaxBps(500); // 5%
    await token.connect(owner).setAmmPair(pair.address, true);

    await token.connect(minter).mint(alice.address, ethers.parseEther("1000"));
    await token.connect(minter).mint(pair.address, ethers.parseEther("1000"));

    // ordinary transfer alice -> bob: no tax
    await token.connect(alice).transfer(bob.address, ethers.parseEther("100"));
    expect(await token.balanceOf(bob.address)).to.eq(ethers.parseEther("100"));
    expect(await token.balanceOf(await token.getAddress())).to.eq(0);

    // sell: alice -> pair, 5% tax accrues in the contract
    await token.connect(alice).transfer(pair.address, ethers.parseEther("100"));
    expect(await token.balanceOf(await token.getAddress())).to.eq(ethers.parseEther("5"));

    // buy: pair -> bob, 5% tax
    await token.connect(pair).transfer(bob.address, ethers.parseEther("100"));
    expect(await token.balanceOf(await token.getAddress())).to.eq(ethers.parseEther("10"));
    expect(await token.balanceOf(bob.address)).to.eq(ethers.parseEther("195")); // 100 + 95

    // distribute accrued tax to jackpot recipient
    await token.distributeTax();
    expect(await token.balanceOf(jackpot.address)).to.eq(ethers.parseEther("10"));
    expect(await token.balanceOf(await token.getAddress())).to.eq(0);
  });

  it("exempts configured addresses from tax", async () => {
    const { owner, minter, pair, alice, token } = await deploy();
    await token.connect(owner).setMinter(minter.address);
    await token.connect(owner).setTaxRecipient(owner.address);
    await token.connect(owner).setTaxBps(1000);
    await token.connect(owner).setAmmPair(pair.address, true);
    await token.connect(owner).setTaxExempt(alice.address, true);

    await token.connect(minter).mint(alice.address, ethers.parseEther("100"));
    await token.connect(alice).transfer(pair.address, ethers.parseEther("100")); // exempt -> no tax
    expect(await token.balanceOf(await token.getAddress())).to.eq(0);
    expect(await token.balanceOf(pair.address)).to.eq(ethers.parseEther("100"));
  });

  it("caps the tax rate", async () => {
    const { owner, token } = await deploy();
    await expect(token.connect(owner).setTaxBps(1001)).to.be.revertedWithCustomError(token, "TaxTooHigh");
    await expect(token.connect(owner).setTaxBps(1000)).to.not.be.reverted;
  });
});
